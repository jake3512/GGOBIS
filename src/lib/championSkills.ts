// Per-champion passive/skill data from Data Dragon's champion-detail
// endpoint (`.../data/{locale}/champion/{slug}.json`) — the same official,
// free, no-auth source already used for the champion list/items/runes.
// Unlike those, this endpoint is one request PER champion, so it's fetched
// on demand (like build recommendations) rather than all at once, and
// cached per champion.
//
// The ability *text* (name/description) is real official Riot data. The
// `tags` derived from it are NOT official — Riot doesn't publish a
// structured "this ability is a stun" taxonomy, so this module infers tags
// by keyword-matching the Korean ability text against a small set of
// well-established LoL terms (기절=stun, 속박=root, 돌진=dash, ...). It's a
// heuristic classifier, not ground truth: a description that never uses one
// of these words won't be tagged even if the ability effectively does that
// thing, and rare phrasing can be missed. Kept deliberately small and
// single-purpose (CC / mobility / shield-heal) rather than trying to
// exhaustively categorize every ability, for the same reason teamComp.ts
// stays restrained to what's actually knowable — see scoreEnemyCompFit's
// use of this data for how much weight it's allowed next to real win rates.

const DDRAGON_BASE = "https://ddragon.leagueoflegends.com";

export type AbilityTag = "hardCC" | "slow" | "mobility" | "shield" | "heal";

export interface AbilitySummary {
  key: "P" | "Q" | "W" | "E" | "R";
  name: string;
  /** HTML-stripped description text, official Riot copy (Korean by default). */
  description: string;
  tags: AbilityTag[];
  /** Max cast range across ranks, straight from Data Dragon's numeric
   * `range` field (real data, not inferred) — 0/undefined for passives and
   * self-cast spells. Used as the poke signal in compConcepts.ts: a
   * champion whose kit has no long-range spell can't really "poke". */
  maxRange?: number;
}

export interface ChampionAbilities {
  slug: string;
  passive: AbilitySummary;
  spells: AbilitySummary[]; // [Q, W, E, R]
  hasHardCC: boolean;
  /** Slow-only CC (둔화) — kept separate from hasHardCC so the UI can tell
   * "완전히 무력화하는 CC" apart from "그냥 느려지는" softer CC, even for a
   * champion whose kit has both (hasHardCC already covers that case; this
   * just isn't downgraded by it). */
  hasSoftCC: boolean;
  hasMobility: boolean;
  hasShieldOrHeal: boolean;
  /** Any non-ultimate spell (Q/W/E) with maxRange >= LONG_RANGE_THRESHOLD. */
  hasLongRange: boolean;
}

// Root Korean terms for each tag. Matched as plain substrings (not full
// phrases) since Riot's exact phrasing varies per ability ("기절시킵니다" vs
// "짧은 시간 동안 기절 상태로 만듭니다" vs "기절 효과") but all reliably contain
// the bare term. False positives are possible (e.g. flavor text mentioning a
// word in passing) but rare in practice for these specific game-terminology
// words, and this only ever feeds a small, clamped nudge — see
// scoreEnemyCompFit — not a claim of precision.
const HARD_CC_TERMS = ["기절", "속박", "침묵", "매혹", "공포", "도발", "수면", "제압", "공중으로 띄워", "이동 불가"];
const SLOW_TERMS = ["둔화"];
const MOBILITY_TERMS = ["돌진", "도약", "순간 이동"];
const SHIELD_TERMS = ["보호막"];
const HEAL_TERMS = ["체력을 회복", "체력 회복", "체력을 재생", "생명력을 흡수"];

// Riot's own numeric spell range (not a keyword heuristic) — 900 is a
// common rough cutoff between "has to walk up" and "can hit from a real
// distance" in LoL's own terms (basic attacks/melee range top out well
// below this; most auto-attack-range-ish abilities sit under it too).
const LONG_RANGE_THRESHOLD = 900;

function stripHtml(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/\{\{[^}]*\}\}/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function classify(text: string): AbilityTag[] {
  const tags: AbilityTag[] = [];
  if (HARD_CC_TERMS.some((t) => text.includes(t))) tags.push("hardCC");
  if (SLOW_TERMS.some((t) => text.includes(t))) tags.push("slow");
  if (MOBILITY_TERMS.some((t) => text.includes(t))) tags.push("mobility");
  if (SHIELD_TERMS.some((t) => text.includes(t))) tags.push("shield");
  if (HEAL_TERMS.some((t) => text.includes(t))) tags.push("heal");
  return tags;
}

function toAbilitySummary(
  key: AbilitySummary["key"],
  raw: { name: string; description?: string; tooltip?: string; range?: number[] },
): AbilitySummary {
  const text = stripHtml(`${raw.description ?? ""} ${raw.tooltip ?? ""}`);
  const maxRange = Array.isArray(raw.range) && raw.range.length > 0 ? Math.max(...raw.range) : undefined;
  return {
    key,
    name: raw.name,
    description: stripHtml(raw.description ?? ""),
    tags: classify(text),
    maxRange,
  };
}

const cache = new Map<string, { value: ChampionAbilities; fetchedAt: number }>();
const ABILITIES_TTL_MS = 60 * 60 * 1000; // 1 hour, matches the other ddragon caches

async function fetchChampionAbilities(slug: string, locale: string, version: string): Promise<ChampionAbilities> {
  const res = await fetch(`${DDRAGON_BASE}/cdn/${version}/data/${locale}/champion/${slug}.json`, {
    next: { revalidate: 3600 },
  });
  if (!res.ok) {
    throw new Error(`Data Dragon champion/${slug}.json request failed: ${res.status}`);
  }
  const body = await res.json();
  const raw = body.data?.[slug];
  if (!raw) throw new Error(`Data Dragon champion/${slug}.json had no data for "${slug}"`);

  const passive = toAbilitySummary("P", raw.passive);
  const spellKeys: AbilitySummary["key"][] = ["Q", "W", "E", "R"];
  const spells = (raw.spells as { name: string; description?: string; tooltip?: string; range?: number[] }[]).map(
    (s, i) => toAbilitySummary(spellKeys[i], s),
  );
  // Poke reads on the basic-ability arsenal (Q/W/E), not the ultimate —
  // most champions have at least one long-range R (global/near-global
  // ultimates), which would make hasLongRange meaningless if it counted.
  const nonUltimateSpells = spells.slice(0, 3);

  return {
    slug,
    passive,
    spells,
    hasHardCC: [passive, ...spells].some((a) => a.tags.includes("hardCC")),
    hasSoftCC: [passive, ...spells].some((a) => a.tags.includes("slow")),
    hasMobility: [passive, ...spells].some((a) => a.tags.includes("mobility")),
    hasShieldOrHeal: [passive, ...spells].some((a) => a.tags.includes("shield") || a.tags.includes("heal")),
    hasLongRange: nonUltimateSpells.some((a) => (a.maxRange ?? 0) >= LONG_RANGE_THRESHOLD),
  };
}

/** Fetches (and caches, 1hr, per champion) a champion's passive+Q/W/E/R with
 * heuristic tags. Only fetches on demand — callers should limit this to a
 * bounded candidate list (see SKILL_FIT_CANDIDATE_LIMIT in the pick-advice
 * route), not every champion in a 20-40-long recommendation list. */
export async function getChampionAbilitiesWithCache(
  slug: string,
  version: string,
  locale = "ko_KR",
): Promise<ChampionAbilities> {
  const cacheKey = `${locale}:${slug}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.fetchedAt < ABILITIES_TTL_MS) {
    return hit.value;
  }
  const value = await fetchChampionAbilities(slug, locale, version);
  cache.set(cacheKey, { value, fetchedAt: Date.now() });
  return value;
}
