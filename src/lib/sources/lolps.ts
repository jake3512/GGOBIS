// lol.ps identifies champions by Riot's own numeric championId (no slug
// mapping needed) and serves per-champion counter data pre-computed as
// parallel arrays (counterChampionIdList/counterWinrateList/counterCountList)
// embedded in a SvelteKit hydration script — a completely different shape
// from the generic "array of {champion, winRate} objects" the other sources
// use (see src/lib/scrape.ts), so this source is implemented directly
// instead of through genericSource.ts.
//
// Confirmed by hand against real page saves the user provided
// (https://lol.ps/champ/75 → Nasus), which embed a script like:
//   __sveltekit_xxxxx = { ..., data: [null, {...}, null, {type:"data",
//     data:{ championId:75, champSummary:[{
//       laneId: 0,
//       counterChampionIdList: [799,80,98,24,164],       // champions that beat this pick
//       counterWinrateList: [48.43,48.5,...],             // this champion's win rate vs. them
//       counterCountList: [1592,600,...],
//       counterEasyChampionIdList: [36,67,150,85,79],     // champions this pick beats easily
//       counterEasyWinrateList: [59.4,57.47,...],
//       counterEasyCountList: [1165,990,...],
//       ...
//     }, ...] } }, ...] }
// This is a JS object literal (unquoted keys), not JSON, so it can't be
// JSON.parse'd — the fields we need are pulled out with targeted regexes
// instead of a full parse.
//
// Known limitation, confirmed by hand: the page's lane-selector tabs
// (탑/정글/미드/바텀/서폿) switch the displayed stats without changing the
// URL or causing any network request that showed up in the browser's
// Network tab (tried ?lane=<n> query params, tried an unfiltered "All"
// request list) — a plain fetch of https://lol.ps/champ/{championId}
// always returns that champion's own most-played lane, whichever one that
// is, and there's no known way to ask for a different one from outside the
// site. So this source only contributes data when the requested position
// happens to match the champion's own primary lane (checked via the
// response's laneId) — a mismatch is treated as "no data from this
// source", never shown as if it were the requested lane's data.

import { cached } from "@/lib/cache";
import type { Position } from "@/lib/positions";
import { fetchHtml } from "@/lib/scrape";
import type {
  ChampionRef,
  SourceCounterResult,
  SourceDuoResult,
  StatSource,
} from "@/lib/sources/types";

const CACHE_TTL_MS = 10 * 60 * 1000;

// Matches Riot's own TEAM_POSITION order; verified by cross-referencing the
// on-page lane-share percentages (탑 78.7% / 정글 4.6% / 미드 15.7% /
// 바텀 0.5% / 서폿 0.6%) against champSummary's top1..5LaneId/Ratio fields.
const LANE_ID_TO_POSITION: Record<number, Position> = {
  0: "top",
  1: "jungle",
  2: "mid",
  3: "adc",
  4: "support",
};

function extractBalancedArraySource(html: string, key: string): string | null {
  const marker = `${key}:[`;
  const start = html.indexOf(marker);
  if (start === -1) return null;
  const openBracket = start + marker.length - 1;
  let depth = 0;
  for (let i = openBracket; i < html.length; i++) {
    if (html[i] === "[") depth++;
    else if (html[i] === "]") {
      depth--;
      if (depth === 0) return html.slice(openBracket, i + 1);
    }
  }
  return null;
}

function extractNumberArray(source: string, key: string): number[] {
  const match = source.match(new RegExp(`${key}:\\[([^\\]]*)\\]`));
  if (!match) return [];
  return match[1]
    .split(",")
    .map(Number)
    .filter((n) => Number.isFinite(n));
}

function extractNumberField(source: string, key: string): number | null {
  const match = source.match(new RegExp(`${key}:(-?\\d+(?:\\.\\d+)?)`));
  return match ? Number(match[1]) : null;
}

interface ChampSummary {
  laneId: number;
  entries: { championId: number; winRate: number; games: number }[];
}

function parseChampSummary(html: string): ChampSummary | null {
  const block = extractBalancedArraySource(html, "champSummary");
  if (!block) return null;

  const laneId = extractNumberField(block, "laneId");
  if (laneId === null) return null;

  const entries: ChampSummary["entries"] = [];
  const zip = (ids: number[], winRates: number[], games: number[]) => {
    ids.forEach((championId, i) => {
      if (winRates[i] === undefined) return;
      entries.push({
        championId,
        winRate: winRates[i] > 1 ? winRates[i] / 100 : winRates[i],
        games: games[i] ?? 0,
      });
    });
  };
  zip(
    extractNumberArray(block, "counterChampionIdList"),
    extractNumberArray(block, "counterWinrateList"),
    extractNumberArray(block, "counterCountList"),
  );
  zip(
    extractNumberArray(block, "counterEasyChampionIdList"),
    extractNumberArray(block, "counterEasyWinrateList"),
    extractNumberArray(block, "counterEasyCountList"),
  );

  if (entries.length === 0) return null;
  return { laneId, entries };
}

async function fetchChampSummary(championId: number): Promise<ChampSummary> {
  return cached(`lolps:champ:${championId}`, CACHE_TTL_MS, async () => {
    const html = await fetchHtml(`https://lol.ps/champ/${championId}`);
    const summary = parseChampSummary(html);
    if (!summary) {
      throw new Error("lol.ps: fetched the page but couldn't locate matchup data in it.");
    }
    return summary;
  });
}

function resolveChampionId(slug: string, champions: ChampionRef[]): number {
  const champion = champions.find((c) => c.slug === slug);
  if (!champion) {
    throw new Error(`lol.ps: unknown champion slug ${slug}`);
  }
  return champion.id;
}

export const lolpsSource: StatSource = {
  id: "lolps",
  label: "lol.ps",
  confidence: "medium",

  async getLaneCounters(dataDragonSlug, position, champions): Promise<SourceCounterResult> {
    const championId = resolveChampionId(dataDragonSlug, champions);
    const summary = await fetchChampSummary(championId);
    const actualPosition = LANE_ID_TO_POSITION[summary.laneId];
    if (actualPosition !== position) {
      throw new Error(
        `lol.ps: only shows this champion's own primary lane (${actualPosition ?? "알 수 없음"}) — ${position} data isn't available from this source.`,
      );
    }
    return {
      sourceId: "lolps",
      sourceLabel: "lol.ps",
      sourceUrl: `https://lol.ps/champ/${championId}`,
      counters: summary.entries,
    };
  },

  async getBotDuoSynergy(): Promise<SourceDuoResult> {
    throw new Error("lol.ps: bottom-lane duo synergy page not identified yet — not supported.");
  },
};
