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
import { POSITIONS, type Position } from "@/lib/positions";
import { fetchHtml } from "@/lib/scrape";
import type {
  ChampionRef,
  SourceCounterResult,
  SourceDuoResult,
  StatSource,
} from "@/lib/sources/types";

const CACHE_TTL_MS = 10 * 60 * 1000;

// `region`/`tier` query params shared by the graphs.json and versus/stats.json
// endpoints below — both real captured requests used the exact same values
// (region=0, tier=2), on two different occasions, which is why these are
// hardcoded constants rather than left off like `version` (see the comments
// at each call site for the full reasoning): `version` moved between the two
// captures (153 vs 154) — clearly a patch-counter that goes stale — while
// region/tier stayed identical, consistent with being fixed site-wide
// defaults ("global" region, some fixed skill bracket) rather than anything
// that varies per request. Still unconfirmed against a live response (no
// outbound access to lol.ps from this environment) — if power-curve/versus
// data is still missing after this, these two values are the next thing to
// re-check against a fresh browser capture.
const LOLPS_REGION = 0;
const LOLPS_TIER = 2;

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

/** Exposed so callers that opt into showing lol.ps's data even on a lane
 * mismatch (see getChampionBuild's `allowMismatch`) can label which lane the
 * data actually represents. */
export function laneIdToPosition(laneId: number): Position | undefined {
  return LANE_ID_TO_POSITION[laneId];
}

function positionLabel(position: Position | undefined): string {
  return POSITIONS.find((p) => p.value === position)?.label ?? "알 수 없는 라인";
}

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
  // Some fields (counts, ids) are raw numbers; others (win/pick/ban rates)
  // are quoted strings like `"52.72"` — handle both.
  const match = source.match(new RegExp(`${key}:"?(-?\\d+(?:\\.\\d+)?)"?`));
  return match ? Number(match[1]) : null;
}

/** Pulls every number out of a (possibly nested) bracketed array, e.g. both
 * `foo:[1,2,3]` and `foo:[[1],[2,3]]` — used for fields like
 * startingItemIdList that nest sub-arrays we don't need to distinguish for
 * display purposes, just the ids in order. */
function extractFlatNumberArray(source: string, key: string): number[] {
  const block = extractBalancedArraySource(source, key);
  if (!block) return [];
  return (block.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number).filter((n) => Number.isFinite(n));
}

function extractStringArray(source: string, key: string): string[] {
  const match = source.match(new RegExp(`${key}:\\[([^\\]]*)\\]`));
  if (!match) return [];
  return match[1]
    .split(",")
    .map((s) => s.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);
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

/** Both champSummary (counters) and the build data below live in the same
 * champion-page HTML — fetched and cached once here so parsing either (or
 * both) never double-fetches the page. */
function fetchChampPageHtml(championId: number): Promise<string> {
  return cached(`lolps:page:${championId}`, CACHE_TTL_MS, () =>
    fetchHtml(`https://lol.ps/champ/${championId}`),
  );
}

// --- Current lol.ps version, for graphs.json/versus/stats.json ---
//
// Confirmed by a real captured page (https://lol.ps/champ/75, fetched with
// no `?version=` in the URL) that this same champion-page HTML we already
// fetch for champSummary/build embeds the resolved-current version TWICE:
//   - championArguments:{regionId:0,versionId:154,tierId:2,laneId:0} — the
//     per-champion data block's OWN resolved query params for exactly this
//     request (which omitted version), proving the server picks "current"
//     here when it's left out.
//   - versionInfo:[{versionId:154,description:"26.17",patchDate:"2026-08-26",
//     isActive:true,...},{versionId:153,...},{versionId:152,...}] — a
//     separate page-level (not per-champion) list of recent versions, newest
//     first; championArguments.versionId matched its first/newest entry.
// graphs.json and versus/stats.json are DIFFERENT endpoints and don't do
// this same "current" fallback themselves (confirmed separately: omitting
// version there returns a near-empty old snapshot, versionId 51) — but since
// the version number is a global "current patch" value (same for every
// champion on a given day, not per-champion), reading it back out of
// whichever page HTML we already fetch works for any of them and avoids a
// dedicated "what's current" request.
const VERSION_CACHE_TTL_MS = 60 * 60 * 1000; // changes once per patch (~weeks), not per request — same idea as ddragon's getLatestVersion cache

function extractCurrentVersionId(html: string): number | null {
  const match = html.match(/championArguments:\{[^}]*versionId:(\d+)/);
  return match ? Number(match[1]) : null;
}

let versionCache: { value: number; fetchedAt: number } | null = null;

/** Best-effort current lol.ps versionId — `championId` is just which
 * champion's page to read it FROM (any champion works, see above); pass
 * whichever one the caller already needs a page fetch for so this can reuse
 * `fetchChampPageHtml`'s cache instead of adding a new request. Cached
 * separately from that page's own (shorter) TTL, and never throws — a
 * failure just means the caller falls back to omitting `version`, the same
 * degraded-but-not-broken behavior this app had before this existed. */
async function getCurrentLolpsVersion(championId: number): Promise<number | null> {
  if (versionCache && Date.now() - versionCache.fetchedAt < VERSION_CACHE_TTL_MS) {
    return versionCache.value;
  }
  try {
    const html = await fetchChampPageHtml(championId);
    const versionId = extractCurrentVersionId(html);
    if (versionId === null) return null;
    versionCache = { value: versionId, fetchedAt: Date.now() };
    return versionId;
  } catch {
    return null;
  }
}

async function fetchChampSummary(championId: number): Promise<ChampSummary> {
  const html = await fetchChampPageHtml(championId);
  const summary = parseChampSummary(html);
  if (!summary) {
    throw new Error("lol.ps: fetched the page but couldn't locate matchup data in it.");
  }
  return summary;
}

/** Per-lane play-rate breakdown from champSummary's `top1LaneId`/
 * `top1LaneRatio` .. `top5LaneId`/`top5LaneRatio` fields (same "topN"
 * ranking convention as `top1ThreeCoreIdList` elsewhere in this blob — #1
 * most-played lane through #5). This is what the file-header comment's
 * "탑 78.7% / 정글 4.6% / 미드 15.7% / 바텀 0.5% / 서폿 0.6%"
 * cross-reference was checking against. Returns a 0-1 fraction per
 * position; a lane absent from the top 5 (essentially never played) isn't
 * a key in the result. */
function parseLaneShareRatios(html: string): Partial<Record<Position, number>> {
  const block = extractBalancedArraySource(html, "champSummary");
  if (!block) return {};
  const shares: Partial<Record<Position, number>> = {};
  for (let n = 1; n <= 5; n++) {
    const laneId = extractNumberField(block, `top${n}LaneId`);
    const ratioRaw = extractNumberField(block, `top${n}LaneRatio`);
    if (laneId === null || ratioRaw === null) continue;
    const position = LANE_ID_TO_POSITION[laneId];
    if (!position) continue;
    shares[position] = ratioRaw > 1 ? ratioRaw / 100 : ratioRaw;
  }
  return shares;
}

/** How often this champion is actually played at `position`, as a 0-1
 * fraction of their games. Meant for gating "show lol.ps's data anyway on a
 * lane mismatch" decisions elsewhere (e.g. pick-advice candidates) on
 * whether `position` is even a real secondary lane for this champion,
 * rather than a near-never-played fluke. Returns 0 if `position` isn't
 * among the champion's top 5 played lanes. */
export async function getLaneShare(championId: number, position: Position): Promise<number> {
  const html = await fetchChampPageHtml(championId);
  return parseLaneShareRatios(html)[position] ?? 0;
}

// --- Champion build (items/runes/spells/skill order) ---
//
// All pulled from the same champSummary block used for counters above — no
// extra request needed. Confirmed by hand against the real Nasus
// champSummary dump (see scrape.ts/lolps.ts history): each entry carries
// mainRuneCategory/mainRune1-4 (keystone + primary tree), subRuneCategory/
// subRune1-2 (secondary tree), spell1Id/spell2Id, startingItemIdList,
// top1ThreeCoreIdList (+ Winrate/Pickrate/Count — the single most-played
// winning 3-item core), coreItemIdList (fuller 5-item reference order, no
// dedicated win rate of its own), shoesId, skillMasterList (max-rank skill
// order, e.g. ["Q","W","E"]) + skillMasterWinrate/Pickrate, and
// skillLv15List (level 1-15 skill-up order). Same known limitation as
// getLaneCounters: only reflects the champion's own primary lane.
export interface ChampionBuild {
  laneId: number;
  mainRuneTreeId: number | null;
  mainRunes: number[];
  subRuneTreeId: number | null;
  subRunes: number[];
  runeWinRate: number | null;
  runeGames: number | null;
  spell1Id: number | null;
  spell2Id: number | null;
  startingItemIds: number[];
  startingWinRate: number | null;
  startingGames: number | null;
  coreItemIds: number[];
  coreWinRate: number | null;
  coreGames: number | null;
  fullBuildItemIds: number[];
  shoesId: number | null;
  skillMaxOrder: string[];
  skillMaxWinRate: number | null;
  skillMaxGames: number | null;
  skillLevelOrder: string[];
  /** One win rate/pick rate/games-sample for the WHOLE build combination
   * (rune+item+spell+skill together), as opposed to the per-section rates
   * above which are each measured independently. lol.ps doesn't expose this
   * as a separate concept (undefined here), but deeplol.gg does — its
   * build_lst entries only carry one overall win_rate/pick_rate/games per
   * variant, with every per-section rate zeroed out. Optional so lol.ps
   * builds don't need to fake a value. */
  overallWinRate?: number | null;
  overallPickRate?: number | null;
  overallGames?: number | null;
}

function toRate(v: number | null): number | null {
  if (v === null) return null;
  return v > 1 ? v / 100 : v;
}

function parseChampionBuild(html: string): ChampionBuild | null {
  const block = extractBalancedArraySource(html, "champSummary");
  if (!block) return null;

  const laneId = extractNumberField(block, "laneId");
  if (laneId === null) return null;

  return {
    laneId,
    mainRuneTreeId: extractNumberField(block, "mainRuneCategory"),
    mainRunes: [1, 2, 3, 4]
      .map((n) => extractNumberField(block, `mainRune${n}`))
      .filter((n): n is number => n !== null),
    subRuneTreeId: extractNumberField(block, "subRuneCategory"),
    subRunes: [1, 2]
      .map((n) => extractNumberField(block, `subRune${n}`))
      .filter((n): n is number => n !== null),
    runeWinRate: toRate(extractNumberField(block, "runeTotalWinrate")),
    runeGames: extractNumberField(block, "runeTotalCount"),
    spell1Id: extractNumberField(block, "spell1Id"),
    spell2Id: extractNumberField(block, "spell2Id"),
    startingItemIds: extractFlatNumberArray(block, "startingItemIdList"),
    startingWinRate: toRate(extractNumberField(block, "startingWinrate")),
    startingGames: extractNumberField(block, "startingCount"),
    coreItemIds: extractFlatNumberArray(block, "top1ThreeCoreIdList"),
    coreWinRate: toRate(extractNumberField(block, "top1ThreeCoreWinrate")),
    coreGames: extractNumberField(block, "top1ThreeCoreCount"),
    fullBuildItemIds: extractFlatNumberArray(block, "coreItemIdList"),
    shoesId: extractNumberField(block, "shoesId"),
    skillMaxOrder: extractStringArray(block, "skillMasterList"),
    skillMaxWinRate: toRate(extractNumberField(block, "skillMasterWinrate")),
    skillMaxGames: extractNumberField(block, "skillMasterCount"),
    skillLevelOrder: extractStringArray(block, "skillLv15List"),
  };
}

async function fetchChampionBuild(championId: number): Promise<ChampionBuild> {
  const html = await fetchChampPageHtml(championId);
  const build = parseChampionBuild(html);
  if (!build) {
    throw new Error("lol.ps: fetched the page but couldn't locate build data in it.");
  }
  return build;
}

/** Public entry point: this champion's build (items/runes/spells/skills)
 * for `position`. lol.ps only ever has data for the champion's own primary
 * lane (see the file-header comment) — by default this throws when that
 * doesn't match `position`, same as before. Pass `allowMismatch: true` to
 * get the primary-lane build back anyway (e.g. a "빌드" tab where seeing
 * the champion's real main-lane build off-lane is more useful than nothing)
 * — callers doing this should surface `build.laneId` (via laneIdToPosition)
 * to the user, since the numbers shown are for a different lane than asked. */
export async function getChampionBuild(
  championId: number,
  position: Position,
  opts?: { allowMismatch?: boolean },
): Promise<ChampionBuild> {
  const build = await fetchChampionBuild(championId);
  const actualPosition = LANE_ID_TO_POSITION[build.laneId];
  if (actualPosition !== position && !opts?.allowMismatch) {
    throw new Error(
      `lol.ps: only shows this champion's own primary lane (${actualPosition ?? "알 수 없음"}) — ${position} build data isn't available from this source.`,
    );
  }
  return build;
}

function resolveChampionId(slug: string, champions: ChampionRef[]): number {
  const champion = champions.find((c) => c.slug === slug);
  if (!champion) {
    throw new Error(`lol.ps: unknown champion slug ${slug}`);
  }
  return champion.id;
}

// "파워 커브" (power curve): a per-minute win-rate line for the champion's
// own primary lane, served from a plain JSON API — a completely different,
// much cleaner endpoint than the page's embedded champSummary above. Found
// by having the user export a full HAR of the champion page and grepping it
// for "graphs.json"; confirmed against a real captured response for Gwen
// (championId 887):
//   GET https://lol.ps/api/champ/887/graphs.json?region=0&version=153&tier=2&lane=0&range=two_weeks
//   -> { data: { timelineWinrates: ["42.98","45.37",...,"25.25"] (31
//        values), laneId: 3, championId: 887, versionId: 153, tierId: 2 } }
// Same known limitation as champSummary: the `lane` query param is present
// in the real request but doesn't appear to control anything — the
// response's laneId reflects the champion's own primary lane regardless,
// so this is only usable when that matches the position being asked about.
// The on-page x-axis showed minute labels 5,9,13,...,33 (one tick every 4
// points); with 31 points total that lines up with one point per minute
// starting at minute 3 (3,4,...,33) — inferred from that spacing, not
// confirmed directly by the API response itself.
// `region`/`tier` are sent (LOLPS_REGION/LOLPS_TIER above). `version` used to
// be left out the same way op.gg's `patch` is, betting the server would fall
// back to "current" — confirmed WRONG by a real capture: omitting it returns
// a near-empty old snapshot (versionId 51, timelineWinrates: []), not the
// current patch. Fixed by fetching the real current versionId (see
// getCurrentLolpsVersion above) and always sending it explicitly.
const CURVE_START_MINUTE = 3;

export interface PowerCurvePoint {
  minute: number;
  winRate: number;
}

export interface PowerCurve {
  laneId: number;
  points: PowerCurvePoint[];
  earlyWinRate: number | null;
  midWinRate: number | null;
  lateWinRate: number | null;
}

function average(points: PowerCurvePoint[]): number | null {
  if (points.length === 0) return null;
  return points.reduce((sum, p) => sum + p.winRate, 0) / points.length;
}

async function fetchPowerCurve(championId: number): Promise<PowerCurve> {
  return cached(`lolps:graphs:${championId}`, CACHE_TTL_MS, async () => {
    const version = await getCurrentLolpsVersion(championId);
    const versionParam = version !== null ? `&version=${version}` : "";
    const res = await fetch(
      `https://lol.ps/api/champ/${championId}/graphs.json?region=${LOLPS_REGION}${versionParam}&tier=${LOLPS_TIER}&range=two_weeks`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; semips-lol-app/1.0; personal project, non-commercial)",
          Accept: "application/json",
        },
      },
    );
    if (!res.ok) {
      throw new Error(`lol.ps: power curve request failed (HTTP ${res.status}).`);
    }
    const body = await res.json();
    const laneId = body?.data?.laneId;
    const raw = body?.data?.timelineWinrates;
    if (typeof laneId !== "number" || !Array.isArray(raw) || raw.length === 0) {
      throw new Error("lol.ps: fetched graphs.json but couldn't locate the power curve in it.");
    }
    const points: PowerCurvePoint[] = raw
      .map((v: unknown, i: number) => ({ minute: CURVE_START_MINUTE + i, winRate: Number(v) / 100 }))
      .filter((p) => Number.isFinite(p.winRate));
    if (points.length === 0) {
      throw new Error("lol.ps: power curve data was empty.");
    }
    const third = Math.max(1, Math.floor(points.length / 3));
    return {
      laneId,
      points,
      earlyWinRate: average(points.slice(0, third)),
      midWinRate: average(points.slice(third, points.length - third)),
      lateWinRate: average(points.slice(-third)),
    };
  });
}

export interface PowerCurveSummary {
  earlyWinRate: number | null;
  lateWinRate: number | null;
}

export interface PowerCurveWithLane extends PowerCurveSummary {
  midWinRate: number | null;
  /** The lane this curve actually reflects, per lol.ps's own primary-lane
   * data (see file header) — null if lol.ps didn't return a recognizable
   * laneId at all. Compare against the position you actually wanted to know
   * whether this is a substituted off-lane curve. */
  actualPosition: Position | null;
}

/** One champion's power curve summary, regardless of which lane it actually
 * reflects (unlike getPowerCurvesForPosition, which silently drops anything
 * off the requested lane) — for callers that want to decide for themselves
 * whether a substituted primary-lane curve is still worth showing (e.g. via
 * getLaneShare), the same pattern as getChampionBuild's `allowMismatch`. */
export async function getPowerCurve(championId: number): Promise<PowerCurveWithLane> {
  const curve = await fetchPowerCurve(championId);
  return {
    earlyWinRate: curve.earlyWinRate,
    midWinRate: curve.midWinRate,
    lateWinRate: curve.lateWinRate,
    actualPosition: laneIdToPosition(curve.laneId) ?? null,
  };
}

/** How much `candidate`'s own early/late power curve favors them against
 * `opponent`'s — averages the early-phase and late-phase win-rate
 * differences (candidate minus opponent) onto the same 0.5-neutral-to-1.0
 * "fit" scale scoreEnemyCompFit/allySynergyFitScore use elsewhere in this
 * app (`src/lib/teamComp.ts`, `src/app/api/pickadvice/route.ts`), ±10
 * percentage points treated as roughly a full swing — deliberately
 * conservative/simple, no larger dataset to calibrate an exact cutoff
 * against, same spirit as pickadvice's `laningFitScore` (±2000 gold). Used
 * both for a specific candidate vs the enemy laner (pickadvice) and for the
 * user's own looked-up champion vs each lane counter (/api/counters) — in
 * both cases `candidate` is "our side" and a positive fit means our side's
 * power curve is favored. Returns null when neither phase has data for both
 * sides (best-effort — callers skip this signal rather than forcing a fake
 * neutral 0.5 in that case). */
export function powerCurveVsFitScore(
  candidate: { earlyWinRate: number | null; lateWinRate: number | null },
  opponent: { earlyWinRate: number | null; lateWinRate: number | null },
): number | null {
  const diffs: number[] = [];
  if (candidate.earlyWinRate !== null && opponent.earlyWinRate !== null) {
    diffs.push(candidate.earlyWinRate - opponent.earlyWinRate);
  }
  if (candidate.lateWinRate !== null && opponent.lateWinRate !== null) {
    diffs.push(candidate.lateWinRate - opponent.lateWinRate);
  }
  if (diffs.length === 0) return null;
  const avgDiff = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  return Math.max(0, Math.min(1, 0.5 + avgDiff * 5));
}

/** Power-curve early/late averages for a batch of candidate champions,
 * keyed by championId — only for candidates whose lol.ps primary lane
 * actually matches `position` (same honesty rule as getLaneCounters).
 * Individual failures are swallowed; missing entries just mean "no power
 * curve data for this candidate", not a hard error. */
export async function getPowerCurvesForPosition(
  championIds: number[],
  position: Position,
): Promise<Map<number, PowerCurveSummary>> {
  const settled = await Promise.allSettled(championIds.map((id) => fetchPowerCurve(id)));
  const result = new Map<number, PowerCurveSummary>();
  settled.forEach((r, i) => {
    if (r.status !== "fulfilled") return;
    if (LANE_ID_TO_POSITION[r.value.laneId] !== position) return;
    result.set(championIds[i], {
      earlyWinRate: r.value.earlyWinRate,
      lateWinRate: r.value.lateWinRate,
    });
  });
  return result;
}

// --- 라인전 세부지표 (versus/stats.json) ---
//
// A dedicated head-to-head endpoint, separate from champSummary/graphs.json
// — it takes BOTH champions explicitly (not just one champion's own page).
// Found via the user's Network capture and confirmed against a real
// response for champion1=41 vs champion2=2, lane=0 (top):
//   GET https://lol.ps/api/versus/stats.json?region=0&version=154&tier=2&lane=0&champion1=41&champion2=2
//   -> { data: { count, winRate, champ1Winrate, champ2Winrate, champ1Counts,
//        champ2Counts, count1win, count1lose, goldAt15Min1/2, xpAt15Min1/2,
//        csAt15Min1/2, soloKillBefore15Min1/2, champLevel1/2, kda1/2,
//        percentRelatedKills1/2, turretPlatesTaken1/2,
//        totalDamageDealtToChampionsPerMin1/2, totalDamageTakenPerMin1/2,
//        visionScorePerMin1/2, jugGankingDeathsAt15Min1/2,
//        jugGankingKillsAt15Min1/2, maxLevelLeadLaneOpponent1/2,
//        levelUpFasterThanOpponentLv2/3/6Percent } }
// `region`/`tier` are sent (LOLPS_REGION/LOLPS_TIER); `version` is fetched
// and sent explicitly the same way graphs.json's is (see
// getCurrentLolpsVersion/CURVE_START_MINUTE comment above) rather than
// omitted — confirmed the same "current" fallback doesn't happen here either.
// `champion1`/`champion2`
// determine which side gets the "1"/"2" suffix in the response; we always
// send the ally champion as champion1, so every "*1" field below
// consistently means "our side" and "*2" means the enemy.
//
// Only a laning-phase-focused subset is surfaced here (CS/gold/XP at 15,
// solo kills before 15, level-lead metrics) — this endpoint also has
// whole-game stats (KDA, damage/min, vision score, overall win rate) that
// aren't specifically about the laning phase and would duplicate what the
// counter-matchup win rate already shows elsewhere, so those are left
// unparsed for now.

export interface VersusLaneSide {
  goldAt15: number;
  xpAt15: number;
  csAt15: number;
  soloKillBefore15: number;
  maxLevelLead: number;
}

export interface VersusStats {
  games: number;
  ally: VersusLaneSide;
  enemy: VersusLaneSide;
  /** Fraction of these games (0-1) the ally side hit level 6 before the
   * enemy did — only meaningful from the ally's perspective since it's
   * always computed relative to whichever champion was sent as champion1
   * (see levelUpFasterThanOpponentLv6Percent above). Null if lol.ps didn't
   * return a usable number for it. */
  allyLevel6FirstRate: number | null;
}

function toFiniteNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

const POSITION_TO_LANE_ID: Record<Position, number> = { top: 0, jungle: 1, mid: 2, adc: 3, support: 4 };

/** Head-to-head laning-phase stats between two specific already-known
 * champions at a specific lane. Unlike every other lol.ps function in this
 * file, this ISN'T gated by "does this match the champion's own primary
 * lane" — there's no such concept here, since the API takes the lane
 * explicitly and is presumably counting real games where both champions
 * actually played that lane against each other. Throws (like the rest of
 * this file) when the request fails or the response doesn't have the
 * fields expected — callers wanting best-effort behavior should catch
 * this themselves (same pattern as every other lol.ps call in this app,
 * e.g. computeTeamPowerCurve's Promise.allSettled in pickadvice/route.ts). */
export async function getVersusStats(
  allyChampionId: number,
  enemyChampionId: number,
  position: Position,
): Promise<VersusStats> {
  const laneId = POSITION_TO_LANE_ID[position];
  return cached(`lolps:versus:${allyChampionId}:${enemyChampionId}:${laneId}`, CACHE_TTL_MS, async () => {
    const version = await getCurrentLolpsVersion(allyChampionId);
    const versionParam = version !== null ? `&version=${version}` : "";
    const res = await fetch(
      `https://lol.ps/api/versus/stats.json?region=${LOLPS_REGION}${versionParam}&tier=${LOLPS_TIER}&lane=${laneId}&champion1=${allyChampionId}&champion2=${enemyChampionId}`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; semips-lol-app/1.0; personal project, non-commercial)",
          Accept: "application/json",
        },
      },
    );
    if (!res.ok) {
      throw new Error(`lol.ps: versus stats request failed (HTTP ${res.status}).`);
    }
    const body = await res.json();
    const d = body?.data;
    const games = toFiniteNumber(d?.count);
    const ally: Partial<VersusLaneSide> = {
      goldAt15: toFiniteNumber(d?.goldAt15Min1) ?? undefined,
      xpAt15: toFiniteNumber(d?.xpAt15Min1) ?? undefined,
      csAt15: toFiniteNumber(d?.csAt15Min1) ?? undefined,
      soloKillBefore15: toFiniteNumber(d?.soloKillBefore15Min1) ?? undefined,
      maxLevelLead: toFiniteNumber(d?.maxLevelLeadLaneOpponent1) ?? undefined,
    };
    const enemy: Partial<VersusLaneSide> = {
      goldAt15: toFiniteNumber(d?.goldAt15Min2) ?? undefined,
      xpAt15: toFiniteNumber(d?.xpAt15Min2) ?? undefined,
      csAt15: toFiniteNumber(d?.csAt15Min2) ?? undefined,
      soloKillBefore15: toFiniteNumber(d?.soloKillBefore15Min2) ?? undefined,
      maxLevelLead: toFiniteNumber(d?.maxLevelLeadLaneOpponent2) ?? undefined,
    };
    const complete = (side: Partial<VersusLaneSide>): side is VersusLaneSide =>
      Object.values(side).every((v) => v !== undefined);
    if (games === null || games === 0 || !complete(ally) || !complete(enemy)) {
      throw new Error("lol.ps: fetched versus stats but couldn't locate laning-phase fields in it.");
    }
    return {
      games,
      ally,
      enemy,
      allyLevel6FirstRate: toFiniteNumber(d?.levelUpFasterThanOpponentLv6Percent),
    };
  });
}

export const lolpsSource: StatSource = {
  id: "lolps",
  label: "lol.ps",
  confidence: "medium",

  async getLaneCounters(dataDragonSlug, position, champions): Promise<SourceCounterResult> {
    const championId = resolveChampionId(dataDragonSlug, champions);
    const summary = await fetchChampSummary(championId);
    const actualPosition = LANE_ID_TO_POSITION[summary.laneId];
    // lol.ps only ever has data for the champion's own primary lane — shown
    // anyway on a mismatch (rather than skipped), but the label makes clear
    // which lane the numbers actually come from so they aren't mistaken for
    // `position`'s own data.
    const sourceLabel =
      actualPosition === position ? "lol.ps" : `lol.ps (${positionLabel(actualPosition)} 라인 데이터)`;
    return {
      sourceId: "lolps",
      sourceLabel,
      sourceUrl: `https://lol.ps/champ/${championId}`,
      counters: summary.entries,
    };
  },

  async getBotDuoSynergy(): Promise<SourceDuoResult> {
    throw new Error("lol.ps: bottom-lane duo synergy page not identified yet — not supported.");
  },

  async getBotDuoCandidates(): Promise<SourceCounterResult> {
    throw new Error("lol.ps: bottom-lane duo synergy page not identified yet — not supported.");
  },
};
