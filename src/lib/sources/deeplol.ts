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
// build_lst (items/runes/spells/skill order per lane) is real, rich data
// too, but isn't wired up here — this app's build display is currently
// lol.ps-specific (BuildCard explicitly labels its numbers "lol.ps 기준").
// Left for a future pass if a second per-source build card is wanted.

import { cached } from "@/lib/cache";
import { getLatestVersion } from "@/lib/ddragon";
import type { Position } from "@/lib/positions";
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

interface DeeplolMatchupEntry {
  enemy_champion_id: number;
  win_rate: number;
  games: number;
}

interface DeeplolLaneBuild {
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
