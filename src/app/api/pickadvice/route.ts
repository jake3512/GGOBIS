import { NextResponse } from "next/server";
import {
  getChampionsWithFallback,
  getItemsWithCache,
  getLatestVersion,
  getRunesDataWithCache,
  getSummonerSpellsWithCache,
  type DDragonChampion,
} from "@/lib/ddragon";
import { POSITIONS, type Position } from "@/lib/positions";
import { getAggregatedDuoCandidates, getAggregatedLaneCounters } from "@/lib/sources/aggregate";
import type { AggregatedCounters } from "@/lib/sources/aggregate";
import type { ChampionRef } from "@/lib/sources/types";
import {
  getChampionBuild,
  getLaneShare,
  getPowerCurve,
  getPowerCurvesForPosition,
  laneIdToPosition,
} from "@/lib/sources/lolps";
import { toBuildResult, type BuildResult } from "@/lib/buildRefs";
import { analyzeTeamComp, applySkillFitBonus, scoreEnemyCompFit } from "@/lib/teamComp";
import { getChampionAbilitiesWithCache, type ChampionAbilities } from "@/lib/championSkills";
import { analyzeCompConcepts, lookupConceptMatchup } from "@/lib/compConcepts";

// Only the top handful of each recommendation list gets a power-curve/build/
// skill-kit lookup — the list itself can be 20-40 champions long, and
// fetching a per-champion page/detail file for all of them on every request
// would be wasteful. The top picks are what the user actually looks at.
const POWER_CURVE_CANDIDATE_LIMIT = 5;
const BUILD_CANDIDATE_LIMIT = 5;
const SKILL_FIT_CANDIDATE_LIMIT = 5;

// lol.ps only ever has build/power-curve data for a champion's own primary
// lane. A candidate (or, for the team power curve below, an already-picked
// ally) recommended/placed at a different position still gets that
// primary-lane data shown (rather than silently omitted) as long as the
// *requested* position is at least this common among the champion's own
// games — filters out showing e.g. a support's build on a jungle
// recommendation just because they were jungled once in a thousand games.
const LANE_MISMATCH_MIN_SHARE = 0.07;

const POSITION_LABEL = new Map(POSITIONS.map((p) => [p.value, p.label]));

// How much the two secondary signals below are allowed to move the ranking,
// next to real scraped lane-counter/synergy win rate. Real data stays
// dominant (0.65) — these can only nudge order among close picks, never
// flip a clear lane-counter/synergy edge:
//   - PICK_ENEMY_FIT_WEIGHT: the tag/stat-based "fits the enemy comp"
//     heuristic (and, for the top few, actual skill kits) — see
//     rerankPicks/refineTopWithSkillFit below and
//     scoreEnemyCompFit/applySkillFitBonus in teamComp.ts.
//   - PICK_ALLY_SYNERGY_WEIGHT: real scraped per-champion synergy data
//     against EVERY already-picked ally (not a tag heuristic) — see
//     computeAllySynergyScores below. Weighted higher than the tag-based
//     enemy fit since it's actual measured win-rate data, just per-pair
//     rather than a true 5-champion team stat.
const PICK_REAL_WEIGHT = 0.65;
const PICK_ENEMY_FIT_WEIGHT = 0.15;
const PICK_ALLY_SYNERGY_WEIGHT = 0.2;

// How many of a filled ally's top synergy partners (by measured win rate)
// count toward computeAllySynergyScores's "intersection" — generous enough
// that a candidate doesn't need to be literally the #1 partner for every
// single already-picked ally to register as a match.
const ALLY_SYNERGY_TOP_K = 20;

const VALID_POSITIONS = new Set(POSITIONS.map((p) => p.value));

interface ChampionBrief {
  id: number;
  name: string;
  iconUrl: string;
}

interface SourceValueOut {
  sourceId: string;
  sourceLabel: string;
  winRate: number;
  games: number;
}

interface PickEntry {
  championId: number;
  name: string;
  iconUrl: string;
  winRate: number;
  games: number;
  bySource: SourceValueOut[];
  /** lol.ps power-curve early/late-game win rate — only attached to the
   * top few entries (see POWER_CURVE_CANDIDATE_LIMIT), and only when that
   * champion's lol.ps data actually covers this position. */
  earlyWinRate?: number | null;
  lateWinRate?: number | null;
  /** lol.ps build recommendation — same top-N-only, same-position-only
   * limits as the power curve above. */
  build?: BuildResult | null;
  /** User-declared mastery tier (1 = most proficient) — only set when the
   * caller supplied a champion pool (tier1/tier2/tier3 query params). */
  tier?: 1 | 2 | 3;
  /** How well this candidate's own tags/stats fit the FULL enemy roster
   * filled in so far (not just the laner) — 0.5 = neutral/no signal, up to
   * 1 when both signals in scoreEnemyCompFit apply. Only ever nudges the
   * ranking (see PICK_ENEMY_FIT_WEIGHT) — never overrides real win-rate
   * order. */
  compFit?: number;
  /** How well this candidate's REAL measured synergy data covers the
   * already-picked allies — 0.5 = neutral (no allies filled, or matches
   * none of them), up to 1.0 when it's among the top synergy partners for
   * every filled ally. See computeAllySynergyScores/allySynergyFitScore.
   * Only ever nudges the ranking (PICK_ALLY_SYNERGY_WEIGHT) alongside
   * compFit — never overrides real lane-counter win-rate order. */
  allySynergyFit?: number;
  /** How many of the filled allies (out of allySynergyOutOf) this candidate
   * actually showed up as a top synergy partner for — the real number
   * behind allySynergyFit, shown in the UI instead of the abstract score. */
  allySynergyMatchCount?: number;
  allySynergyOutOf?: number;
  /** Average of the real measured win rates across just the allies it
   * matched (null when allySynergyMatchCount is 0). */
  allySynergyAvgWinRate?: number | null;
}

/** Parses a comma-separated list of champion IDs from a tier1/tier2/tier3
 * query param. Unknown/malformed values are silently dropped — they simply
 * won't match any real entry later. */
function parseTierIds(raw: string | null): number[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n));
}

/** Builds a championId → tier map from the three tier param lists. A
 * champion listed in more than one tier keeps its best (lowest-numbered)
 * tier. */
function buildTierMap(tier1: number[], tier2: number[], tier3: number[]): Map<number, 1 | 2 | 3> {
  const map = new Map<number, 1 | 2 | 3>();
  for (const id of tier1) map.set(id, 1);
  for (const id of tier2) if (!map.has(id)) map.set(id, 2);
  for (const id of tier3) if (!map.has(id)) map.set(id, 3);
  return map;
}

/** Restricts a recommendation list to the caller's declared champion pool
 * and ranks mastery tier ABOVE the underlying win-rate ranking: tier 1
 * candidates come first, then tier 2, then tier 3, and only within the same
 * tier does the existing win-rate order (asc/desc, already applied by
 * toPickEntries) break ties — Array.prototype.sort is stable, so a
 * tier-only comparator preserves that secondary order automatically. When
 * the pool is empty (tierMap.size === 0, i.e. the caller didn't set one up),
 * this is a no-op and every candidate is returned unrestricted, exactly like
 * before this feature existed. */
function restrictToPool(entries: PickEntry[], tierMap: Map<number, 1 | 2 | 3>): PickEntry[] {
  if (tierMap.size === 0) return entries;
  return entries
    .filter((e) => tierMap.has(e.championId))
    .map((e) => ({ ...e, tier: tierMap.get(e.championId) }))
    .sort((a, b) => a.tier! - b.tier!);
}

/** How well a candidate's measured ally-synergy coverage looks, as the same
 * 0.5-neutral-up-to-1.0 scale scoreEnemyCompFit uses — 0.5 when no allies
 * are filled (no signal either way), rising toward 1.0 as `matchCount`
 * approaches `outOf`. Deliberately simple/transparent (just the match
 * ratio) rather than folding in the average win rate too — that real number
 * is shown separately (allySynergyAvgWinRate) rather than baked into a
 * fuzzy composite. */
function allySynergyFitScore(matchCount: number, outOf: number): number {
  if (outOf === 0) return 0.5;
  return 0.5 + (matchCount / outOf) * 0.5;
}

/** For every already-picked ally, fetches their top ALLY_SYNERGY_TOP_K
 * synergy partners (by real measured win rate, from every stat source) and
 * looks for candidates that show up for MULTIPLE allies at once — the
 * "intersection" of good-partner sets. `outOf` in the return value is how
 * many allies actually returned usable synergy data (not necessarily every
 * filled slot, if a source/page lookup failed for one) — that's the
 * accurate denominator for how "complete" a match is. Best-effort per ally
 * (Promise.allSettled): one ally's synergy page being unreachable just
 * drops it from the intersection rather than failing the whole thing. */
async function computeAllySynergyScores(
  allySlots: { position: Position; champ: DDragonChampion }[],
  champions: ChampionRef[],
): Promise<{ scores: Map<number, { matchCount: number; avgWinRate: number | null }>; outOf: number }> {
  if (allySlots.length === 0) return { scores: new Map(), outOf: 0 };
  const settled = await Promise.allSettled(
    allySlots.map(({ champ, position: p }) => getAggregatedDuoCandidates(champ.slug, p, champions)),
  );
  const perAllyTopK: Map<number, number>[] = [];
  for (const r of settled) {
    if (r.status !== "fulfilled") continue;
    const ranked = [...r.value.entries]
      .sort((a, b) => b.primary.winRate - a.primary.winRate)
      .slice(0, ALLY_SYNERGY_TOP_K);
    const map = new Map<number, number>();
    for (const e of ranked) map.set(e.championId, e.primary.winRate);
    perAllyTopK.push(map);
  }
  if (perAllyTopK.length === 0) return { scores: new Map(), outOf: 0 };

  const candidateIds = new Set<number>();
  for (const m of perAllyTopK) for (const id of m.keys()) candidateIds.add(id);

  const scores = new Map<number, { matchCount: number; avgWinRate: number | null }>();
  for (const id of candidateIds) {
    const rates = perAllyTopK.map((m) => m.get(id)).filter((r): r is number => r !== undefined);
    scores.set(id, {
      matchCount: rates.length,
      avgWinRate: rates.length > 0 ? rates.reduce((a, b) => a + b, 0) / rates.length : null,
    });
  }
  return { scores, outOf: perAllyTopK.length };
}

/** Re-ranks a pick list against two secondary signals: how well each
 * candidate fits the FULL enemy roster filled in so far (`enemyChamps` —
 * every enemy slot the user has filled in, laner included, tag-based), and
 * how well it covers the already-picked allies' real measured synergy data
 * (`allySynergy` — see computeAllySynergyScores). Attaches `compFit` and
 * `allySynergyFit` (+ the raw match count/win rate behind it) to every
 * entry, then sorts by a blended score: real scraped win rate
 * (PICK_REAL_WEIGHT) plus both secondary signals (PICK_ENEMY_FIT_WEIGHT /
 * PICK_ALLY_SYNERGY_WEIGHT). Must run BEFORE restrictToPool, since that
 * function's tier sort is stable and relies on whatever order it's handed
 * as the tiebreaker within a tier — so this is what decides "same tier"
 * ordering once a champion pool is active, and the sole ordering when it
 * isn't. When enemyChamps/allySynergy are both empty, both secondary scores
 * are a flat 0.5 for every candidate and this reduces to sorting by real
 * win rate alone — i.e. unchanged relative order from before either
 * feature existed. */
function rerankPicks(
  entries: PickEntry[],
  champById: Map<number, DDragonChampion>,
  enemyChamps: DDragonChampion[],
  allySynergy: { scores: Map<number, { matchCount: number; avgWinRate: number | null }>; outOf: number },
  order: "asc" | "desc",
): PickEntry[] {
  return entries
    .map((e) => {
      const champ = champById.get(e.championId);
      const compFit = champ ? scoreEnemyCompFit(champ, enemyChamps) : 0.5;
      const synergy = allySynergy.scores.get(e.championId);
      return {
        ...e,
        compFit,
        allySynergyFit: allySynergyFitScore(synergy?.matchCount ?? 0, allySynergy.outOf),
        allySynergyMatchCount: synergy?.matchCount ?? 0,
        allySynergyOutOf: allySynergy.outOf,
        allySynergyAvgWinRate: synergy?.avgWinRate ?? null,
      };
    })
    .sort((a, b) => {
      const goodnessA = order === "asc" ? 1 - a.winRate : a.winRate;
      const goodnessB = order === "asc" ? 1 - b.winRate : b.winRate;
      const rankA =
        PICK_REAL_WEIGHT * goodnessA + PICK_ENEMY_FIT_WEIGHT * a.compFit! + PICK_ALLY_SYNERGY_WEIGHT * a.allySynergyFit!;
      const rankB =
        PICK_REAL_WEIGHT * goodnessB + PICK_ENEMY_FIT_WEIGHT * b.compFit! + PICK_ALLY_SYNERGY_WEIGHT * b.allySynergyFit!;
      return rankB - rankA;
    });
}

/** Refines the top N entries of `picks` (mutated in place, then re-sorted)
 * using each side's ACTUAL passive/Q/W/E/R kit instead of just the coarse
 * champion tags rerankPicks already applied — see applySkillFitBonus/
 * championSkills.ts for what that adds and why it's bounded to a shortlist
 * (one Data Dragon request per champion). Re-sorts only that shortlist, and
 * tier (from a champion pool, if active) is kept as the dominant key so
 * this never reorders across tiers — it only refines the order within
 * whatever restrictToPool already grouped together; allySynergyFit is left
 * exactly as rerankPicks set it (this pass only bonuses compFit). Best-
 * effort: any failure (Data Dragon down, shape changed) just leaves the
 * tag-based compFit from rerankPicks as-is. */
async function refineTopWithSkillFit(
  picks: PickEntry[],
  champById: Map<number, DDragonChampion>,
  enemyChamps: DDragonChampion[],
  order: "asc" | "desc",
): Promise<void> {
  const top = picks.slice(0, SKILL_FIT_CANDIDATE_LIMIT);
  if (top.length === 0 || enemyChamps.length === 0) return;
  try {
    const version = await getLatestVersion();
    const enemyResults = await Promise.allSettled(
      enemyChamps.map((c) => getChampionAbilitiesWithCache(c.slug, version)),
    );
    const enemyAbilities = enemyResults
      .filter((r): r is PromiseFulfilledResult<ChampionAbilities> => r.status === "fulfilled")
      .map((r) => r.value);
    if (enemyAbilities.length === 0) return;

    const candidateResults = await Promise.allSettled(
      top.map((p) => {
        const champ = champById.get(p.championId);
        if (!champ) return Promise.reject(new Error("unknown champion"));
        return getChampionAbilitiesWithCache(champ.slug, version);
      }),
    );
    top.forEach((entry, i) => {
      const r = candidateResults[i];
      if (r.status !== "fulfilled") return;
      entry.compFit = applySkillFitBonus(entry.compFit ?? 0.5, r.value, enemyAbilities);
    });

    top.sort((a, b) => {
      const tierDiff = (a.tier ?? 0) - (b.tier ?? 0);
      if (tierDiff !== 0) return tierDiff;
      const goodnessA = order === "asc" ? 1 - a.winRate : a.winRate;
      const goodnessB = order === "asc" ? 1 - b.winRate : b.winRate;
      const rankA =
        PICK_REAL_WEIGHT * goodnessA +
        PICK_ENEMY_FIT_WEIGHT * (a.compFit ?? 0.5) +
        PICK_ALLY_SYNERGY_WEIGHT * (a.allySynergyFit ?? 0.5);
      const rankB =
        PICK_REAL_WEIGHT * goodnessB +
        PICK_ENEMY_FIT_WEIGHT * (b.compFit ?? 0.5) +
        PICK_ALLY_SYNERGY_WEIGHT * (b.allySynergyFit ?? 0.5);
      return rankB - rankA;
    });
    picks.splice(0, top.length, ...top);
  } catch {
    // Data Dragon unreachable or shape changed — tag-based compFit stands.
  }
}

/** Best-effort fetches abilities for a bounded set of already-picked
 * champions (at most 5 per side — the draft board, not a candidate list),
 * for the comp-concept analysis below. Failures for individual champions
 * are silently dropped (Promise.allSettled) — analyzeCompConcepts already
 * treats a missing entry as "no ability data for this one", not a hard
 * failure, same as every other best-effort annotation in this route. */
async function fetchAbilitiesMap(
  champs: DDragonChampion[],
  version: string,
): Promise<Map<number, ChampionAbilities>> {
  const results = await Promise.allSettled(champs.map((c) => getChampionAbilitiesWithCache(c.slug, version)));
  const map = new Map<number, ChampionAbilities>();
  results.forEach((r, i) => {
    if (r.status === "fulfilled") map.set(champs[i].id, r.value);
  });
  return map;
}

/** Mutates the top N entries of `picks` in place, attaching lol.ps
 * power-curve early/late-game win rates where available. Best-effort: any
 * failure (lol.ps down, no matching lane data) just leaves those fields
 * unset rather than failing the whole request. */
async function annotateWithPowerCurve(picks: PickEntry[], position: Position): Promise<void> {
  const top = picks.slice(0, POWER_CURVE_CANDIDATE_LIMIT);
  if (top.length === 0) return;
  try {
    const curves = await getPowerCurvesForPosition(
      top.map((p) => p.championId),
      position,
    );
    for (const entry of top) {
      const curve = curves.get(entry.championId);
      if (curve) {
        entry.earlyWinRate = curve.earlyWinRate;
        entry.lateWinRate = curve.lateWinRate;
      }
    }
  } catch {
    // lol.ps unreachable or shape changed — leave power-curve fields unset.
  }
}

/** Mutates the top N entries of `picks` in place, attaching a lol.ps build
 * recommendation where available. Best-effort like annotateWithPowerCurve —
 * failures (lol.ps or Data Dragon down) just leave `build` unset for that
 * entry. Shows the champion's own primary-lane build even when it doesn't
 * match `position`, same as the "빌드" tab, but only when `position` itself
 * is at least BUILD_LANE_MISMATCH_MIN_SHARE of the candidate's own games —
 * otherwise (as before) the mismatch just leaves `build` unset. */
async function annotateWithBuild(picks: PickEntry[], position: Position): Promise<void> {
  const top = picks.slice(0, BUILD_CANDIDATE_LIMIT);
  if (top.length === 0) return;
  try {
    const [items, spells, runesData] = await Promise.all([
      getItemsWithCache(),
      getSummonerSpellsWithCache(),
      getRunesDataWithCache(),
    ]);
    const results = await Promise.allSettled(
      top.map((p) => getChampionBuild(p.championId, position, { allowMismatch: true })),
    );
    await Promise.all(
      results.map(async (r, i) => {
        if (r.status !== "fulfilled") return;
        const build = r.value;
        const actualPosition = laneIdToPosition(build.laneId);
        if (actualPosition && actualPosition !== position) {
          const share = await getLaneShare(top[i].championId, position).catch(() => 0);
          if (share < LANE_MISMATCH_MIN_SHARE) return;
        }
        const entry = top[i];
        entry.build = toBuildResult(
          { id: entry.championId, name: entry.name, iconUrl: entry.iconUrl },
          position,
          build,
          { items, spells, runes: runesData.runes, trees: runesData.trees },
        );
      }),
    );
  } catch {
    // Data Dragon or lol.ps unreachable — leave build fields unset.
  }
}

function toBrief(c: DDragonChampion): ChampionBrief {
  return { id: c.id, name: c.name, iconUrl: c.iconUrl };
}

interface LanerPowerCurve {
  position: Position;
  champion: ChampionBrief;
  earlyWinRate: number | null;
  midWinRate: number | null;
  lateWinRate: number | null;
  /** Set when this laner's numbers are actually lol.ps's data for a
   * DIFFERENT lane (see LANE_MISMATCH_MIN_SHARE) — same idea as
   * BuildResult.laneNote. */
  laneNote: string | null;
}

interface TeamPowerCurve {
  laners: LanerPowerCurve[];
  teamEarlyWinRate: number | null;
  teamMidWinRate: number | null;
  teamLateWinRate: number | null;
  /** How many of the 5 ally slots actually contributed a curve — the team
   * averages above are only over these, not padded with anything for the
   * missing slots. */
  sampledCount: number;
}

function average(values: number[]): number | null {
  return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

/** Aggregates lol.ps power curves across every filled ally slot into a
 * per-laner early/mid/late breakdown plus a team-wide average per phase —
 * best-effort like the other lol.ps annotations (a champion lol.ps has no
 * curve for, or unreachable, just isn't counted rather than failing the
 * whole request). Each laner's numbers come from their own primary lane on
 * lol.ps; when that's not the slot's actual position, it's only used if
 * this position is at least LANE_MISMATCH_MIN_SHARE of that champion's own
 * games (flagged via laneNote), same leniency rule as annotateWithBuild. */
async function computeTeamPowerCurve(
  allySlots: { position: Position; champ: DDragonChampion }[],
): Promise<TeamPowerCurve> {
  if (allySlots.length === 0) {
    return { laners: [], teamEarlyWinRate: null, teamMidWinRate: null, teamLateWinRate: null, sampledCount: 0 };
  }
  const settled = await Promise.allSettled(allySlots.map(({ champ }) => getPowerCurve(champ.id)));
  const laners: LanerPowerCurve[] = [];
  await Promise.all(
    settled.map(async (r, i) => {
      if (r.status !== "fulfilled") return;
      const { position, champ } = allySlots[i];
      const curve = r.value;
      let laneNote: string | null = null;
      if (curve.actualPosition && curve.actualPosition !== position) {
        const share = await getLaneShare(champ.id, position).catch(() => 0);
        if (share < LANE_MISMATCH_MIN_SHARE) return;
        laneNote = `lol.ps는 ${champ.name}의 ${POSITION_LABEL.get(curve.actualPosition) ?? curve.actualPosition} 라인 데이터만 갖고 있어요 — 아래 수치는 실제로 그 라인 기준입니다.`;
      }
      laners.push({
        position,
        champion: toBrief(champ),
        earlyWinRate: curve.earlyWinRate,
        midWinRate: curve.midWinRate,
        lateWinRate: curve.lateWinRate,
        laneNote,
      });
    }),
  );
  laners.sort(
    (a, b) => POSITIONS.findIndex((p) => p.value === a.position) - POSITIONS.findIndex((p) => p.value === b.position),
  );

  const collect = (key: "earlyWinRate" | "midWinRate" | "lateWinRate") =>
    average(laners.map((l) => l[key]).filter((v): v is number => v !== null));

  return {
    laners,
    teamEarlyWinRate: collect("earlyWinRate"),
    teamMidWinRate: collect("midWinRate"),
    teamLateWinRate: collect("lateWinRate"),
    sampledCount: laners.length,
  };
}

function toPickEntries(
  result: AggregatedCounters,
  champById: Map<number, DDragonChampion>,
  order: "asc" | "desc",
): PickEntry[] {
  return result.entries
    .map((entry) => {
      const champ = champById.get(entry.championId);
      if (!champ) return null;
      return {
        championId: entry.championId,
        name: champ.name,
        iconUrl: champ.iconUrl,
        winRate: entry.primary.winRate,
        games: entry.primary.games,
        bySource: entry.bySource.map((s) => ({
          sourceId: s.sourceId,
          sourceLabel: s.sourceLabel,
          winRate: s.winRate,
          games: s.games,
        })),
      };
    })
    .filter((e): e is PickEntry => e !== null)
    .sort((a, b) => (order === "asc" ? a.winRate - b.winRate : b.winRate - a.winRate));
}

/** Finds one specific champion's entry within an aggregated ranked list —
 * used to turn "all counters for X" / "all synergy partners for Y" into a
 * single pairwise number for two SPECIFIC already-picked champions. */
function findMatch(
  result: AggregatedCounters,
  championId: number,
): { winRate: number; games: number; bySource: SourceValueOut[] } | null {
  const entry = result.entries.find((e) => e.championId === championId);
  if (!entry) return null;
  return {
    winRate: entry.primary.winRate,
    games: entry.primary.games,
    bySource: entry.bySource.map((s) => ({
      sourceId: s.sourceId,
      sourceLabel: s.sourceLabel,
      winRate: s.winRate,
      games: s.games,
    })),
  };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const position = searchParams.get("position") as Position | null;

  if (!position || !VALID_POSITIONS.has(position)) {
    return NextResponse.json(
      { error: `position must be one of: ${[...VALID_POSITIONS].join(", ")}` },
      { status: 400 },
    );
  }

  const champions = await getChampionsWithFallback();
  const champById = new Map(champions.map((c) => [c.id, c]));

  const tierMap = buildTierMap(
    parseTierIds(searchParams.get("tier1")),
    parseTierIds(searchParams.get("tier2")),
    parseTierIds(searchParams.get("tier3")),
  );
  const championPoolActive = tierMap.size > 0;

  // Full 10-slot draft board: ally-{position} / enemy-{position} for each
  // of the 5 positions, all optional.
  const slotIds: Record<string, number> = {};
  const unknownSlots: string[] = [];
  for (const side of ["ally", "enemy"] as const) {
    for (const p of POSITIONS) {
      const key = `${side}-${p.value}`;
      const raw = searchParams.get(key);
      if (!raw) continue;
      const id = Number(raw);
      if (!champById.has(id)) {
        unknownSlots.push(key);
        continue;
      }
      slotIds[key] = id;
    }
  }
  if (unknownSlots.length > 0) {
    return NextResponse.json(
      { error: `Unknown champion id for: ${unknownSlots.join(", ")}` },
      { status: 400 },
    );
  }

  const slotChampion = (key: string): DDragonChampion | null => champById.get(slotIds[key]) ?? null;

  const enemyLaneChampion = slotChampion(`enemy-${position}`);
  const supportAdcChampion = slotChampion("ally-adc"); // only relevant when position === "support"

  // Every enemy slot filled in so far (laner included) — feeds rerankPicks
  // below so "내 픽 추천" weighs in the full known enemy roster, not just my
  // direct lane opponent, per the tag-based heuristic in teamComp.ts. Also
  // reused for compHeuristic.enemy further down, so it's computed once here
  // instead of twice.
  const enemyChamps = POSITIONS.map((p) => slotChampion(`enemy-${p.value}`)).filter(
    (c): c is DDragonChampion => c !== null,
  );

  // Every ALLY slot filled in so far, paired with its own position — feeds
  // computeAllySynergyScores/rerankPicks below (real measured synergy
  // against every already-picked ally, not just an ADC), and is reused
  // as-is for compHeuristic.ally and teamPowerCurve further down.
  const allySlotsWithPosition = POSITIONS.map((p) => ({ position: p.value, champ: slotChampion(`ally-${p.value}`) }))
    .filter((s): s is { position: Position; champ: DDragonChampion } => s.champ !== null);
  const allyChamps = allySlotsWithPosition.map((s) => s.champ);
  const allySynergy = await computeAllySynergyScores(allySlotsWithPosition, champions);

  // --- single-pick recommendation for MY empty slot (unchanged logic from
  // before the draft board — just re-derived from the 10-slot params) ---
  let counterPicks: PickEntry[] | null = null;
  let counterError: string | null = null;
  if (enemyLaneChampion) {
    try {
      const result = await getAggregatedLaneCounters(enemyLaneChampion.slug, position, champions);
      const ranked = rerankPicks(toPickEntries(result, champById, "asc"), champById, enemyChamps, allySynergy, "asc");
      counterPicks = restrictToPool(ranked, tierMap);
      await refineTopWithSkillFit(counterPicks, champById, enemyChamps, "asc");
      await annotateWithPowerCurve(counterPicks, position);
      await annotateWithBuild(counterPicks, position);
    } catch (err) {
      counterError = err instanceof Error ? err.message : "라인전 카운터 조회에 실패했습니다.";
    }
  }

  let synergyPicks: PickEntry[] | null = null;
  let synergyError: string | null = null;
  if (position === "support" && supportAdcChampion) {
    try {
      const result = await getAggregatedDuoCandidates(supportAdcChampion.slug, "adc", champions);
      const ranked = rerankPicks(toPickEntries(result, champById, "desc"), champById, enemyChamps, allySynergy, "desc");
      synergyPicks = restrictToPool(ranked, tierMap);
      await refineTopWithSkillFit(synergyPicks, champById, enemyChamps, "desc");
      await annotateWithPowerCurve(synergyPicks, position);
      await annotateWithBuild(synergyPicks, position);
    } catch (err) {
      synergyError = err instanceof Error ? err.message : "시너지 조회에 실패했습니다.";
    }
  }

  const combinedPicks =
    counterPicks && synergyPicks
      ? counterPicks
          .flatMap((c) => {
            const s = synergyPicks!.find((s) => s.championId === c.championId);
            if (!s) return [];
            const realScore = (1 - c.winRate + s.winRate) / 2;
            const enemyFitScore = ((c.compFit ?? 0.5) + (s.compFit ?? 0.5)) / 2;
            const allySynergyFit = ((c.allySynergyFit ?? 0.5) + (s.allySynergyFit ?? 0.5)) / 2;
            const score =
              PICK_REAL_WEIGHT * realScore +
              PICK_ENEMY_FIT_WEIGHT * enemyFitScore +
              PICK_ALLY_SYNERGY_WEIGHT * allySynergyFit;
            return [
              {
                championId: c.championId,
                name: c.name,
                iconUrl: c.iconUrl,
                counterWinRate: c.winRate,
                counterGames: c.games,
                synergyWinRate: s.winRate,
                synergyGames: s.games,
                compFit: enemyFitScore,
                score,
                tier: c.tier,
              },
            ];
          })
          // Stable sort trick for a two-key ordering: sort by the
          // secondary key (score desc) first, then by the primary key
          // (mastery tier asc) — the tier pass preserves each tier's
          // internal score-desc order because Array.prototype.sort is
          // stable. When no pool is set every tier is undefined and this
          // second sort is a no-op, so behavior is unchanged.
          .sort((a, b) => b.score - a.score)
          .sort((a, b) => (a.tier ?? 0) - (b.tier ?? 0))
          .slice(0, 5)
      : [];

  // --- "실측 데이터" 전체 시너지: look up SPECIFIC already-picked pairs
  // (not "who should I pick") using the exact same scraped lane-counter and
  // duo-synergy data, across every position both sides have filled in. ---
  const laneResults = await Promise.all(
    POSITIONS.map(async (p) => {
      const ally = slotChampion(`ally-${p.value}`);
      const enemy = slotChampion(`enemy-${p.value}`);
      if (!ally || !enemy) return null;
      try {
        const result = await getAggregatedLaneCounters(enemy.slug, p.value, champions);
        const match = findMatch(result, ally.id);
        return {
          position: p.value,
          ally: toBrief(ally),
          enemy: toBrief(enemy),
          // match.winRate is the ENEMY champion's win rate vs our ally pick
          // (that's what the scraped "counters" list is keyed on) — invert
          // it so this reads as our own side's win probability throughout.
          winRate: match ? 1 - match.winRate : null,
          games: match?.games ?? null,
          bySource: match ? match.bySource.map((s) => ({ ...s, winRate: 1 - s.winRate })) : [],
          error: null as string | null,
        };
      } catch (err) {
        return {
          position: p.value,
          ally: toBrief(ally),
          enemy: toBrief(enemy),
          winRate: null,
          games: null,
          bySource: [] as SourceValueOut[],
          error: err instanceof Error ? err.message : "조회에 실패했습니다.",
        };
      }
    }),
  );
  const lanes = laneResults.filter((l): l is NonNullable<typeof l> => l !== null);

  const duoAdc = slotChampion("ally-adc");
  const duoSupport = slotChampion("ally-support");
  let duo: {
    adc: ChampionBrief;
    support: ChampionBrief;
    winRate: number | null;
    games: number | null;
    bySource: SourceValueOut[];
    error: string | null;
  } | null = null;
  if (duoAdc && duoSupport) {
    try {
      const result = await getAggregatedDuoCandidates(duoAdc.slug, "adc", champions);
      const match = findMatch(result, duoSupport.id);
      duo = {
        adc: toBrief(duoAdc),
        support: toBrief(duoSupport),
        winRate: match?.winRate ?? null,
        games: match?.games ?? null,
        bySource: match?.bySource ?? [],
        error: null,
      };
    } catch (err) {
      duo = {
        adc: toBrief(duoAdc),
        support: toBrief(duoSupport),
        winRate: null,
        games: null,
        bySource: [],
        error: err instanceof Error ? err.message : "조회에 실패했습니다.",
      };
    }
  }

  const scoreValues = [
    ...lanes.filter((l) => l.winRate !== null).map((l) => l.winRate as number),
    ...(duo?.winRate !== null && duo?.winRate !== undefined ? [duo.winRate] : []),
  ];
  const overallScore =
    scoreValues.length > 0 ? scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length : null;

  const measuredSynergy = { lanes, duo, overallScore };

  // --- "챔피언 특성 기반" 조합 분석: Riot 공식 정적 데이터(tags/info)만
  // 사용하는, 승률과 무관한 보조 지표. src/lib/teamComp.ts 참고.
  // (allySlotsWithPosition/allyChamps/enemyChamps were already computed
  // above, before counterPicks/synergyPicks, so rerankPicks could use them
  // too — reused here as-is.) ---
  const compHeuristic = {
    ally: analyzeTeamComp(allyChamps),
    enemy: analyzeTeamComp(enemyChamps),
  };

  // --- lol.ps 파워 커브(분당 승률)를 우리팀 채워진 라인 전체에 걸쳐 종합해서
  // 팀이 어느 구간(초반/중반/후반)에 가장 강한지, 각 라이너는 초반/후반 중
  // 어느 쪽에 가까운지 보여줌. src 상단 computeTeamPowerCurve 참고. ---
  const teamPowerCurve = await computeTeamPowerCurve(allySlotsWithPosition);

  // --- 조합 컨셉(돌진/포킹/쌍포/한타/스플릿) 감지 + 정적 상성 참고표.
  // src/lib/compConcepts.ts 참고 — 실측 승률이 아니라 전략 지식 참고표임을
  // 응답에도 명시. 픽 추천(counterPicks 등)과 달리 이미 채워진 최대 10명
  // (양 팀 5명씩)만 다루므로 후보 리스트 규모 걱정 없이 매 요청 시도. ---
  let compConcepts: {
    ally: ReturnType<typeof analyzeCompConcepts>;
    enemy: ReturnType<typeof analyzeCompConcepts>;
    matchup: ReturnType<typeof lookupConceptMatchup>;
  } = { ally: null, enemy: null, matchup: null };
  try {
    const version = await getLatestVersion();
    const [allyAbilities, enemyAbilities] = await Promise.all([
      fetchAbilitiesMap(allyChamps, version),
      fetchAbilitiesMap(enemyChamps, version),
    ]);
    const allyConcepts = analyzeCompConcepts(allyChamps, allyAbilities);
    const enemyConcepts = analyzeCompConcepts(enemyChamps, enemyAbilities);
    compConcepts = {
      ally: allyConcepts,
      enemy: enemyConcepts,
      matchup:
        allyConcepts?.dominant && enemyConcepts?.dominant
          ? lookupConceptMatchup(allyConcepts.dominant, enemyConcepts.dominant)
          : null,
    };
  } catch {
    // Data Dragon unreachable — leave compConcepts at the all-null default.
  }

  return NextResponse.json({
    position,
    enemyLaneChampion: enemyLaneChampion ? toBrief(enemyLaneChampion) : null,
    allyAdcChampion: position === "support" && supportAdcChampion ? toBrief(supportAdcChampion) : null,
    championPoolActive,
    counterPicks,
    counterError,
    synergyPicks,
    synergyError,
    combinedPicks,
    measuredSynergy,
    compHeuristic,
    compConcepts,
    teamPowerCurve,
  });
}
