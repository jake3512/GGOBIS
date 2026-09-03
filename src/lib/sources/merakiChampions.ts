// Meraki Analytics' champion resource feed, pulled by the user directly as
// the new base for this app's champion skill data (previously Data
// Dragon's champion-detail endpoint — see the header comment this replaces
// in src/lib/championSkills.ts):
//   https://cdn.merakianalytics.com/riot/lol/resources/latest/en-US/champions/
// One JSON file per champion under that directory, keyed by Riot's own
// champion key (the same identifier Data Dragon's champion.json calls
// `id`/this app calls `slug`, e.g. "Aatrox", "MonkeyKing" for Wukong) — so
// every existing caller of getChampionAbilitiesWithCache(slug, ...) keeps
// working unchanged; only what happens inside it changed.
//
// "이 링크를 전적으로 신뢰하고" (trust this link entirely) — so this fetches
// EXACTLY the en-US path the user gave, with no locale-swap attempt this
// time (unlike Community Dragon's items.json, where a ko_kr sibling path
// was fairly confidently known to exist — Meraki's locale coverage isn't
// something this session could confirm either way, and the user asked to
// trust the given link as-is rather than have it second-guessed). The
// practical consequence: ability names/descriptions surfaced from this
// source are in ENGLISH, not Korean — see championSkills.ts's now-English
// keyword lists, translated from the old Korean ones for exactly this
// reason.
//
// IMPORTANT — none of this could be verified against a live response: this
// session's sandbox has outbound network access blocked for
// cdn.merakianalytics.com (same organization-policy block that already
// applied to ddragon.leagueoflegends.com, namu.wiki, and
// raw.communitydragon.org — every external LoL data host this session has
// tried is blocked). The shape below is built from general familiarity
// with Meraki's CDragon-based champion resource schema, not a fetch this
// session actually made — the numeric fields in particular (cooldown/cost/
// range) are parsed defensively (multiple fallback shapes tried, never
// throws) specifically because their exact nesting couldn't be confirmed;
// a wrong guess there just means that one numeric detail doesn't show for
// some abilities, not a crash. If the real deploy shows missing/wrong
// ability text or numbers, the actual response JSON for one champion is
// what's needed to correct this.

const BASE_URL = "https://cdn.merakianalytics.com/riot/lol/resources/latest/en-US/champions/";

export interface MerakiAbility {
  name: string;
  /** Concatenated ability blurb + all per-rank effect descriptions — the
   * text championSkills.ts's keyword classifier runs against. */
  text: string;
  /** Per-rank values, when this ability's cooldown could be found in a
   * recognized shape — undefined (not an empty array) when it couldn't, so
   * callers can tell "no cooldown" (passives) from "shape didn't match". */
  cooldown?: number[];
  cost?: number[];
  range?: number[];
}

export interface MerakiChampion {
  key: string;
  passive: MerakiAbility;
  /** [Q, W, E, R] */
  spells: MerakiAbility[];
}

/** Meraki's ability numeric fields (cooldown/cost/range) have been seen
 * modeled a couple of different ways across this kind of CDragon-derived
 * resource — a flat number array, or an object wrapping a rank-value array
 * under something like `modifiers[0].values`. Tries the shapes this file
 * knows about and returns undefined rather than guessing further if none
 * match, so a schema mismatch just drops that one numeric detail instead
 * of producing a wrong number. */
function extractNumericProgression(raw: unknown): number[] | undefined {
  if (Array.isArray(raw) && raw.every((v) => typeof v === "number")) {
    return raw as number[];
  }
  if (raw && typeof raw === "object") {
    const modifiers = (raw as { modifiers?: unknown }).modifiers;
    if (Array.isArray(modifiers) && modifiers.length > 0) {
      const values = (modifiers[0] as { values?: unknown })?.values;
      if (Array.isArray(values) && values.every((v) => typeof v === "number")) {
        return values as number[];
      }
    }
  }
  return undefined;
}

interface RawMerakiEffect {
  description?: string;
}

interface RawMerakiAbility {
  name?: string;
  blurb?: string;
  description?: string;
  cooldown?: unknown;
  cost?: unknown;
  range?: unknown;
  effects?: RawMerakiEffect[];
}

interface RawMerakiChampion {
  key?: string;
  abilities?: {
    P?: RawMerakiAbility[];
    Q?: RawMerakiAbility[];
    W?: RawMerakiAbility[];
    E?: RawMerakiAbility[];
    R?: RawMerakiAbility[];
  };
}

function toAbility(raw: RawMerakiAbility | undefined): MerakiAbility {
  if (!raw) return { name: "", text: "" };
  const effectText = (raw.effects ?? []).map((e) => e.description ?? "").join(" ");
  const text = [raw.blurb, raw.description, effectText].filter(Boolean).join(" ");
  return {
    name: raw.name ?? "",
    text,
    cooldown: extractNumericProgression(raw.cooldown),
    cost: extractNumericProgression(raw.cost),
    range: extractNumericProgression(raw.range),
  };
}

async function fetchMerakiChampion(slug: string): Promise<MerakiChampion> {
  const res = await fetch(`${BASE_URL}${slug}.json`, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; semips-lol-app/1.0; personal project, non-commercial)",
      Accept: "application/json",
    },
    next: { revalidate: 3600 },
  });
  if (!res.ok) {
    throw new Error(`Meraki Analytics: champions/${slug}.json request failed (HTTP ${res.status}).`);
  }
  const raw = (await res.json()) as RawMerakiChampion;
  const abilities = raw.abilities ?? {};
  // Each key (P/Q/W/E/R) holds an array because some champions have
  // multiple passive-slot forms (form-swap kits) — this app only ever
  // needs one representative entry per key, same simplification Data
  // Dragon's own single-object-per-slot shape already made for us before.
  return {
    key: raw.key ?? slug,
    passive: toAbility(abilities.P?.[0]),
    spells: [toAbility(abilities.Q?.[0]), toAbility(abilities.W?.[0]), toAbility(abilities.E?.[0]), toAbility(abilities.R?.[0])],
  };
}

const cache = new Map<string, { value: MerakiChampion; fetchedAt: number }>();
const CACHE_TTL_MS = 60 * 60 * 1000;

/** Fetches (and caches, 1hr, per champion) a champion's passive+Q/W/E/R
 * from Meraki Analytics. Only fetches on demand — callers should limit
 * this to a bounded candidate list, not every champion in a 20-40-long
 * recommendation list (same convention championSkills.ts's own caller-
 * facing function already documents). */
export async function getMerakiChampionWithCache(slug: string): Promise<MerakiChampion> {
  const hit = cache.get(slug);
  if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) {
    return hit.value;
  }
  const value = await fetchMerakiChampion(slug);
  cache.set(slug, { value, fetchedAt: Date.now() });
  return value;
}
