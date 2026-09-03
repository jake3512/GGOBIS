// Per-champion passive/skill data — base source is Meraki Analytics'
// champion resource feed (src/lib/sources/merakiChampions.ts,
// https://cdn.merakianalytics.com/riot/lol/resources/latest/en-US/champions/),
// switched over from Data Dragon's champion-detail endpoint per direct
// request ("챔피언 스킬 데이터를 datadragon에서... 링크로 베이스를
// 바꿔줘... 이 링크를 전적으로 신뢰하고"). Every exported name/type/
// function here is unchanged from the Data Dragon version on purpose — this
// module is consumed from pickadvice/counters/compcompare/teamComp.ts/
// compConcepts.ts, and keeping the public shape identical meant none of
// those call sites needed to change, only what happens inside
// fetchChampionAbilities below.
//
// The ability *text* (name/description) is real data from that feed. The
// `tags` derived from it are NOT official — no LoL data source publishes a
// structured "this ability is a stun" taxonomy, so this module infers tags
// by keyword-matching the ability text against a small set of
// well-established LoL terms (stun, root, dash, ...). It's a heuristic
// classifier, not ground truth: a description that never uses one of these
// words won't be tagged even if the ability effectively does that thing,
// and rare phrasing can be missed. Kept deliberately small and
// single-purpose (CC / mobility / shield-heal) rather than trying to
// exhaustively categorize every ability, for the same reason teamComp.ts
// stays restrained to what's actually knowable — see scoreEnemyCompFit's
// use of this data for how much weight it's allowed next to real win rates.
//
// Terms are in ENGLISH now, not Korean — Meraki's feed (the link given) is
// en-US, unlike Data Dragon's ko_KR champion text this module used before.

import { getMerakiChampionWithCache, type MerakiAbility } from "@/lib/sources/merakiChampions";

export type AbilityTag = "hardCC" | "slow" | "mobility" | "shield" | "heal";

export interface AbilitySummary {
  key: "P" | "Q" | "W" | "E" | "R";
  name: string;
  /** Ability text (English, from Meraki) used for the keyword classifier —
   * not shown verbatim in the UI (see AbilityDetails below for the
   * client-facing shape), just the raw source for `tags`. */
  description: string;
  tags: AbilityTag[];
  /** Max cast range across ranks, from Meraki's numeric `range` field when
   * it could be parsed (real data, not inferred) — undefined for passives,
   * self-cast spells, or if the response's range shape didn't match any
   * pattern this app knows how to parse (see extractNumericProgression,
   * src/lib/sources/merakiChampions.ts). Used as the poke signal in
   * compConcepts.ts: a champion whose kit has no long-range spell can't
   * really "poke". */
  maxRange?: number;
  /** Per-rank cooldown/cost, when parseable — new "상세 정보" fields
   * (not used for tag classification, just surfaced to the client per
   * "상세 정보 제공을 늘려줘"). */
  cooldown?: number[];
  cost?: number[];
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

/** Just the five boolean tags off ChampionAbilities, without the ability
 * text/slug — the shape returned to the client as a "핵심 태그" summary on
 * pick-recommendation/lane-counter candidate cards (see toKeyTags below).
 * Kept as its own type rather than reusing ChampionAbilities directly so
 * API responses don't leak full ability descriptions just to show five
 * booleans. */
export interface KeyTags {
  hasHardCC: boolean;
  hasSoftCC: boolean;
  hasMobility: boolean;
  hasShieldOrHeal: boolean;
  hasLongRange: boolean;
}

export function toKeyTags(a: ChampionAbilities): KeyTags {
  return {
    hasHardCC: a.hasHardCC,
    hasSoftCC: a.hasSoftCC,
    hasMobility: a.hasMobility,
    hasShieldOrHeal: a.hasShieldOrHeal,
    hasLongRange: a.hasLongRange,
  };
}

/** Client-facing per-ability detail — name + cooldown/cost/range only (no
 * raw description text, same "don't leak more than the UI needs" principle
 * KeyTags already followed) — the "상세 정보 제공을 늘려줘" addition, only
 * attached to the same bounded top-N candidates KeyTags already was. */
export interface AbilityDetail {
  key: AbilitySummary["key"];
  name: string;
  cooldown?: number[];
  cost?: number[];
  maxRange?: number;
  /** "주요 스킬 여부를 판단해줘" — true when this ability's text matched at
   * least one of the CC/기동성/보호막/회복 keyword categories above (i.e.
   * `tags.length > 0`), same heuristic KeyTags/hasHardCC etc. already rely
   * on, just applied per-ability instead of aggregated across the whole
   * kit. Same caveat as the rest of this classifier: a purely
   * numbers-based nuke spell with none of those keywords in its text
   * (e.g. "deals X magic damage" and nothing else) won't be flagged as
   * key even though it may well be the champion's core damage tool — this
   * only catches CC/engage/peel-style impact, not raw damage. */
  isKeySkill: boolean;
}

export function toAbilityDetails(a: ChampionAbilities): AbilityDetail[] {
  return [a.passive, ...a.spells].map((s) => ({
    key: s.key,
    name: s.name,
    cooldown: s.cooldown,
    cost: s.cost,
    maxRange: s.maxRange,
    isKeySkill: s.tags.length > 0,
  }));
}

// Root English terms for each tag — translated from this module's old
// Korean term list when its base source switched from Data Dragon (ko_KR)
// to Meraki Analytics (en-US only, see the file header). Matched as plain
// substrings (not full phrases) since exact phrasing varies per ability
// ("stuns them" vs "stunned for a short duration") but all reliably contain
// the bare term. False positives are possible (e.g. flavor text mentioning
// a word in passing) but rare in practice for these specific game-
// terminology words, and this only ever feeds a small, clamped nudge — see
// scoreEnemyCompFit — not a claim of precision.
const HARD_CC_TERMS = [
  "stun",
  "root",
  "snare",
  "silence",
  "charm",
  "fear",
  "taunt",
  "sleep",
  "suppress",
  "knock up",
  "knock back",
  "unable to move",
  "unable to act",
];
const SLOW_TERMS = ["slow"];
const MOBILITY_TERMS = ["dash", "leap", "blink", "teleport"];
const SHIELD_TERMS = ["shield"];
const HEAL_TERMS = ["heal", "restores health", "restore health", "regenerate health", "life steal", "lifesteal"];

// Same rough cutoff as before (Riot's own numeric spell range, not a
// keyword heuristic) — 900 is a common rough cutoff between "has to walk
// up" and "can hit from a real distance" in LoL's own terms.
const LONG_RANGE_THRESHOLD = 900;

function classify(text: string): AbilityTag[] {
  const lower = text.toLowerCase();
  const tags: AbilityTag[] = [];
  if (HARD_CC_TERMS.some((t) => lower.includes(t))) tags.push("hardCC");
  if (SLOW_TERMS.some((t) => lower.includes(t))) tags.push("slow");
  if (MOBILITY_TERMS.some((t) => lower.includes(t))) tags.push("mobility");
  if (SHIELD_TERMS.some((t) => lower.includes(t))) tags.push("shield");
  if (HEAL_TERMS.some((t) => lower.includes(t))) tags.push("heal");
  return tags;
}

function toAbilitySummary(key: AbilitySummary["key"], raw: MerakiAbility): AbilitySummary {
  const maxRange = raw.range && raw.range.length > 0 ? Math.max(...raw.range) : undefined;
  return {
    key,
    name: raw.name,
    description: raw.text,
    tags: classify(raw.text),
    maxRange,
    cooldown: raw.cooldown,
    cost: raw.cost,
  };
}

async function fetchChampionAbilities(slug: string): Promise<ChampionAbilities> {
  const raw = await getMerakiChampionWithCache(slug);
  const passive = toAbilitySummary("P", raw.passive);
  const spellKeys: AbilitySummary["key"][] = ["Q", "W", "E", "R"];
  const spells = raw.spells.map((s, i) => toAbilitySummary(spellKeys[i], s));
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

const cache = new Map<string, { value: ChampionAbilities; fetchedAt: number }>();
const ABILITIES_TTL_MS = 60 * 60 * 1000; // 1 hour, matches the other external-source caches

/** Fetches (and caches, 1hr, per champion) a champion's passive+Q/W/E/R with
 * heuristic tags. Only fetches on demand — callers should limit this to a
 * bounded candidate list (see SKILL_FIT_CANDIDATE_LIMIT in the pick-advice
 * route), not every champion in a 20-40-long recommendation list.
 *
 * `_version` is vestigial — kept only so the many existing call sites
 * across pickadvice/counters/compcompare didn't need to change when this
 * switched from Data Dragon (which needed a patch version in its URL) to
 * Meraki (whose "latest" URL needs none). Ignored internally now. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept for call-site compatibility, see doc comment above
export async function getChampionAbilitiesWithCache(slug: string, _version?: string): Promise<ChampionAbilities> {
  const hit = cache.get(slug);
  if (hit && Date.now() - hit.fetchedAt < ABILITIES_TTL_MS) {
    return hit.value;
  }
  const value = await fetchChampionAbilities(slug);
  cache.set(slug, { value, fetchedAt: Date.now() });
  return value;
}
