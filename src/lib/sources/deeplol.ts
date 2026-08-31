// deeplol.gg's own backend API (b2c-api-cdn.deeplol.gg) — found by having the
// user filter their browser's Network tab for "deeplol" (everything else on
// the page was ad-tech noise: Venatus, IntentIQ, Microsoft Clarity, Google
// Analytics, Lotame) and paste the full request list. This endpoint stood
// out as deeplol's real per-champion data API, distinct from its page shell
// (a client-side-rendered Next.js SPA) and from its own Data Dragon asset
// mirror (ak-deeplol-ddragon-cdn.deeplol.gg).
//
// Confirmed by hand against real Response bodies the user pasted for
// champion_id=75 (Nasus):
//   GET https://b2c-api-cdn.deeplol.gg/champion/build?platform_id=KR&champion_id=75&game_version=16.16&tier=Emerald%2B
//   -> { build_by_lane: { "Top": { match_up: { strong_against: [{enemy_champion_id, win_rate, games, match_rate}, ...], weak_against: [...], synergy_champion: [...] }, build_lst: [...], champion_tier, rank, win_rate, pick_rate, ban_rate, games }, "Middle": {...}, "Aram": {...} } }
// champion_id is Riot's own numeric championId (confirmed against Data
// Dragon: 75 = Nasus, 223 = Tahm Kench), so — like lol.ps — no slug mapping
// is needed, just a lookup of the numeric id.
//
// Lane keys confirmed by hand: "Top", "Middle", "Aram" (from Nasus's own
// build_by_lane, which only lists lanes he's actually played — a
// top/mid/aram champion, so bottom/jungle/support never showed up in the
// sample). "Jungle"/"Bottom"/"Support" below are inferred from the same
// full-word capitalized convention "Middle" uses, not independently
// confirmed — if a jungler/ADC/support champion's counters come back empty
// from this source, check these three lane-name guesses first.
//
// match_up.synergy_champion carries lane/games/teams/win_rate/pick_rate/
// synergy but NO champion-id field for the synergy partner (unlike
// strong_against/weak_against, which carry enemy_champion_id) — confirmed
// against the real pasted response. Without an id there's no way to know
// which champion an entry refers to, so bottom-lane duo synergy isn't
// implemented from this source (same "not supported" situation as lol.ps).
//
// build_lst (items/runes/spells/skill order per lane) is also real data —
// wired up below as getChampionBuild(), mapped onto the same ChampionBuild
// shape lol.ps produces (src/lib/sources/lolps.ts) so both sources can go
// through the same toBuildResult()/BuildCard rendering path. Field mapping,
// confirmed against the real Nasus "Top" build_lst[0] entry pasted by hand:
//   rune.main_build: [treeId, keystoneId, minor1, minor2, minor3] — first
//     element is the rune TREE id, the rest are the 4 picked runes (matches
//     lol.ps's mainRuneCategory + mainRune1..4 split exactly).
//   rune.sub_build: same shape, [treeId, minor1, minor2] (2 secondary runes).
//   item.build: the finished ~5-6 item "core" set → mapped to coreItemIds.
//   item.detail: full chronological purchase order (paired with
//     detail_price, unused here) → mapped to fullBuildItemIds.
//   spell.build: [spell1Id, spell2Id].
//   start_item.build: starting item ids.
//   boots.item: single boots item id.
//   skill.build: max-rank skill priority as NUMBERS (1=Q,2=W,3=E,4=R), not
//     lol.ps's letter strings — converted via SKILL_INDEX_TO_LETTER.
//   skill.detail: 15-length per-level skill-up order, same numeric encoding.
// Per-field win_rate/games (rune.win_rate, spell.win_rate, etc.) were all
// 0/0 in every sample seen — deeplol apparently only tracks a single overall
// win_rate/games/pick_rate per build_lst entry, not a breakdown per
// rune/spell/item/skill choice like lol.ps does (and `item` doesn't even
// carry a win_rate/games field at all). So the granular *WinRate/*Games
// fields below are null unless the sub-object's own games count is nonzero,
// and the one real number available (the build variant's own win_rate/
// pick_rate/games) is surfaced separately via ChampionBuild's
// overallWinRate/overallPickRate/overallGames — not misattributed to any
// single section like "core items".

import { cached } from "@/lib/cache";
import { getLatestVersion } from "@/lib/ddragon";
import type { Position } from "@/lib/positions";
import type { ChampionBuild } from "@/lib/sources/lolps";
import type {
  ChampionRef,
  SourceCounterResult,
  SourceDuoResult,
  StatSource,
} from "@/lib/sources/types";

const CACHE_TTL_MS = 10 * 60 * 1000;

const POSITION_TO_LANE_NAME: Record<Position, string> = {
  top: "Top",
  jungle: "Jungle",
  mid: "Middle",
  adc: "Bottom",
  support: "Support",
};

// Only used to fill ChampionBuild's laneId field for type compatibility with
// lol.ps's shape — nothing outside lolps.ts's own internal lane-match check
// actually reads that field (confirmed by grepping for `.laneId` usage), so
// this mapping's exact values don't affect behavior, only honesty of the
// returned object. Mirrors lol.ps's own LANE_ID_TO_POSITION numbering.
const POSITION_TO_LANE_ID: Record<Position, number> = {
  top: 0,
  jungle: 1,
  mid: 2,
  adc: 3,
  support: 4,
};

const SKILL_INDEX_TO_LETTER: Record<number, string> = { 1: "Q", 2: "W", 3: "E", 4: "R" };
function skillLetters(indices: number[]): string[] {
  return indices.map((n) => SKILL_INDEX_TO_LETTER[n] ?? "?");
}

interface DeeplolMatchupEntry {
  enemy_champion_id: number;
  win_rate: number;
  games: number;
}

interface DeeplolRateGames {
  win_rate: number;
  games: number;
}

interface DeeplolBuildVariant {
  rune: { main_build: number[]; sub_build: number[] } & DeeplolRateGames;
  item: { build: number[]; detail: number[] };
  spell: { build: number[] } & DeeplolRateGames;
  start_item: { build: number[] } & DeeplolRateGames;
  skill: { build: number[]; detail: number[] } & DeeplolRateGames;
  boots: { item: number } & DeeplolRateGames;
  win_rate: number;
  pick_rate: number;
  games: number;
}

interface DeeplolLaneBuild {
  build_lst: DeeplolBuildVariant[];
  match_up: {
    strong_against: DeeplolMatchupEntry[];
    weak_against: DeeplolMatchupEntry[];
  };
}

interface DeeplolBuildResponse {
  build_by_lane: Record<string, DeeplolLaneBuild>;
}

/** deeplol's `game_version` query param wants "major.minor" (e.g. "16.16"),
 * not Data Dragon's full "major.minor.patch" version string. */
async function gameVersionParam(): Promise<string> {
  const full = await getLatestVersion();
  const [major, minor] = full.split(".");
  return `${major}.${minor}`;
}

async function fetchBuildResponse(championId: number): Promise<DeeplolBuildResponse> {
  return cached(`deeplol:build:${championId}`, CACHE_TTL_MS, async () => {
    const gameVersion = await gameVersionParam();
    const url = `https://b2c-api-cdn.deeplol.gg/champion/build?platform_id=KR&champion_id=${championId}&game_version=${gameVersion}&tier=Emerald%2B`;
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; semips-lol-app/1.0; personal project, non-commercial)",
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      throw new Error(`DeepLoL: build request failed (HTTP ${res.status}).`);
    }
    const body = (await res.json()) as DeeplolBuildResponse;
    if (!body?.build_by_lane) {
      throw new Error("DeepLoL: fetched the build response but couldn't locate build_by_lane in it.");
    }
    return body;
  });
}

function resolveChampionId(slug: string, champions: ChampionRef[]): number {
  const champion = champions.find((c) => c.slug === slug);
  if (!champion) {
    throw new Error(`DeepLoL: unknown champion slug ${slug}`);
  }
  return champion.id;
}

async function fetchLaneCounters(
  dataDragonSlug: string,
  position: Position,
  champions: ChampionRef[],
): Promise<SourceCounterResult> {
  const championId = resolveChampionId(dataDragonSlug, champions);
  const body = await fetchBuildResponse(championId);
  const laneName = POSITION_TO_LANE_NAME[position];
  const lane = body.build_by_lane[laneName];
  if (!lane) {
    throw new Error(`DeepLoL: no ${laneName} lane data for this champion.`);
  }
  // Both directions matter for the "counters" list: weak_against is who
  // beats this champion (the classic "counter" meaning), strong_against is
  // who this champion beats — same "zip both directions into one list" shape
  // as lol.ps's counterChampionIdList + counterEasyChampionIdList.
  const entries = [...lane.match_up.strong_against, ...lane.match_up.weak_against].map((m) => ({
    championId: m.enemy_champion_id,
    winRate: m.win_rate,
    games: m.games,
  }));
  if (entries.length === 0) {
    throw new Error("DeepLoL: fetched the build response but it had no matchup data for this lane.");
  }
  return {
    sourceId: "deeplol",
    sourceLabel: "DeepLoL",
    // Human-facing page URL, inferred from the mobile page URL pattern the
    // user's Network capture showed (m.deeplol.gg/champions/detail?
    // championName=nasus&...&lane=top&tabs=build) — not independently
    // confirmed for every lane value, but this is just an attribution link,
    // not something the app fetches.
    sourceUrl: `https://m.deeplol.gg/champions/detail?championName=${dataDragonSlug.toLowerCase()}&lane=${position}&tabs=build`,
    counters: entries,
  };
}

function mapBuildVariant(variant: DeeplolBuildVariant, position: Position): ChampionBuild {
  const rateOrNull = (rg: DeeplolRateGames): number | null => (rg.games > 0 ? rg.win_rate : null);
  const gamesOrNull = (rg: DeeplolRateGames): number | null => (rg.games > 0 ? rg.games : null);

  return {
    laneId: POSITION_TO_LANE_ID[position],
    mainRuneTreeId: variant.rune.main_build[0] ?? null,
    mainRunes: variant.rune.main_build.slice(1),
    subRuneTreeId: variant.rune.sub_build[0] ?? null,
    subRunes: variant.rune.sub_build.slice(1),
    runeWinRate: rateOrNull(variant.rune),
    runeGames: gamesOrNull(variant.rune),
    spell1Id: variant.spell.build[0] ?? null,
    spell2Id: variant.spell.build[1] ?? null,
    startingItemIds: variant.start_item.build,
    startingWinRate: rateOrNull(variant.start_item),
    startingGames: gamesOrNull(variant.start_item),
    coreItemIds: variant.item.build,
    // deeplol's `item` object has no win_rate/games of its own (confirmed:
    // absent from every sample seen, unlike rune/spell/start_item/skill
    // which at least have the fields, just zeroed) — so there's no real
    // per-item-core number to put here. The one genuine number this source
    // gives is the whole build variant's win_rate/pick_rate/games, surfaced
    // below as overallWinRate/overallPickRate/overallGames instead of
    // being misattributed to "core items" specifically.
    coreWinRate: null,
    coreGames: null,
    fullBuildItemIds: variant.item.detail,
    shoesId: variant.boots.item ?? null,
    skillMaxOrder: skillLetters(variant.skill.build),
    skillMaxWinRate: rateOrNull(variant.skill),
    skillMaxGames: gamesOrNull(variant.skill),
    skillLevelOrder: skillLetters(variant.skill.detail),
    overallWinRate: variant.win_rate,
    overallPickRate: variant.pick_rate,
    overallGames: variant.games,
  };
}

/** This champion's build (items/runes/spells/skills) for `position`,
 * mapped onto lol.ps's ChampionBuild shape — see the field-mapping comment
 * at the top of this file. Unlike lol.ps, deeplol's build_by_lane is
 * genuinely keyed by lane, so — no "only shows the champion's own primary
 * lane" caveat here; a lane simply isn't returned if the champion doesn't
 * play there. Always the single most-played variant (build_lst[0]) — see
 * getChampionBuildVariants below for the other variants deeplol tracks. */
export async function getChampionBuild(
  championId: number,
  position: Position,
): Promise<ChampionBuild> {
  const [variant] = await getChampionBuildVariants(championId, position, 1);
  return variant;
}

/** Same data as getChampionBuild, but returns up to `limit` of deeplol's
 * own ranked build_lst entries instead of just the top one — e.g. a
 * champion with a "표준" build and a situational full-tank or on-hit
 * variant will have those as build_lst[1]/[2]. build_lst is already
 * ordered by deeplol (most-played first, same order the single-variant
 * getChampionBuild has always trusted for "the" build), so this is just
 * that same list sliced wider instead of taken as build_lst[0] alone —
 * added so the 빌드 tab can show more than one real build option per
 * champion, not a new ranking of our own. */
export async function getChampionBuildVariants(
  championId: number,
  position: Position,
  limit = 3,
): Promise<ChampionBuild[]> {
  const body = await fetchBuildResponse(championId);
  const laneName = POSITION_TO_LANE_NAME[position];
  const lane = body.build_by_lane[laneName];
  if (!lane || lane.build_lst.length === 0) {
    throw new Error(`DeepLoL: no ${laneName} lane build data for this champion.`);
  }
  return lane.build_lst.slice(0, limit).map((variant) => mapBuildVariant(variant, position));
}

export const deeplolSource: StatSource = {
  id: "deeplol",
  label: "DeepLoL",
  confidence: "high",

  getLaneCounters: fetchLaneCounters,

  async getBotDuoSynergy(): Promise<SourceDuoResult> {
    throw new Error(
      "DeepLoL: synergy_champion entries don't carry a champion id — bottom-lane duo synergy isn't supported from this source.",
    );
  },

  async getBotDuoCandidates(): Promise<SourceCounterResult> {
    throw new Error(
      "DeepLoL: synergy_champion entries don't carry a champion id — bottom-lane duo synergy isn't supported from this source.",
    );
  },
};
