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
import { getChampionBuild, getPowerCurvesForPosition } from "@/lib/sources/lolps";
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

// How much the enemy-comp-fit heuristics (tags/stats, and separately actual
// skill kits, vs the FULL filled-in enemy roster) are allowed to move the
// ranking, next to real scraped win rates. Real data stays dominant — this
// can only nudge order among close picks, never flip a clear lane-counter/
// synergy edge. See rerankByEnemyCompFit/refineTopWithSkillFit below and
// scoreEnemyCompFit/applySkillFitBonus in teamComp.ts.
const PICK_REAL_WEIGHT = 0.75;
const PICK_FIT_WEIGHT = 0.25;

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
   * ranking (see PICK_FIT_WEIGHT) — never overrides real win-rate order. */
  compFit?: number;
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

/** Re-ranks a pick list to weigh in how well each candidate fits the FULL
 * enemy roster filled in so far — not just the one champion in my own lane
 * (`enemyChamps` here is every enemy slot the user has filled in, laner
 * included). Attaches `compFit` to every entry and re-sorts by a blended
 * score: real scraped win rate (PICK_REAL_WEIGHT) plus the tag-based fit
 * heuristic (PICK_FIT_WEIGHT). Must run BEFORE restrictToPool, since that
 * function's tier sort is stable and relies on whatever order it's handed
 * as the tiebreaker within a tier — so this is what decides "same tier"
 * ordering once a champion pool is active, and the sole ordering when it
 * isn't. When enemyChamps is empty, scoreEnemyCompFit returns a neutral 0.5
 * for every candidate and this reduces to sorting by real win rate alone —
 * i.e. unchanged behavior from before this feature existed. */
function rerankByEnemyCompFit(
  entries: PickEntry[],
  champById: Map<number, DDragonChampion>,
  enemyChamps: DDragonChampion[],
  order: "asc" | "desc",
): PickEntry[] {
  return entries
    .map((e) => {
      const champ = champById.get(e.championId);
      const compFit = champ ? scoreEnemyCompFit(champ, enemyChamps) : 0.5;
      return { ...e, compFit };
    })
    .sort((a, b) => {
      const goodnessA = order === "asc" ? 1 - a.winRate : a.winRate;
      const goodnessB = order === "asc" ? 1 - b.winRate : b.winRate;
      const rankA = PICK_REAL_WEIGHT * goodnessA + PICK_FIT_WEIGHT * a.compFit!;
      const rankB = PICK_REAL_WEIGHT * goodnessB + PICK_FIT_WEIGHT * b.compFit!;
      return rankB - rankA;
    });
}

/** Refines the top N entries of `picks` (mutated in place, then re-sorted)
 * using each side's ACTUAL passive/Q/W/E/R kit instead of just the coarse
 * champion tags rerankByEnemyCompFit already applied — see
 * applySkillFitBonus/championSkills.ts for what that adds and why it's
 * bounded to a shortlist (one Data Dragon request per champion). Re-sorts
 * only that shortlist, and tier (from a champion pool, if active) is kept
 * as the dominant key so this never reorders across tiers — it only
 * refines the order within whatever restrictToPool already grouped
 * together. Best-effort: any failure (Data Dragon down, shape changed)
 * just leaves the tag-based compFit from rerankByEnemyCompFit as-is. */
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
      const rankA = PICK_REAL_WEIGHT * goodnessA + PICK_FIT_WEIGHT * (a.compFit ?? 0.5);
      const rankB = PICK_REAL_WEIGHT * goodnessB + PICK_FIT_WEIGHT * (b.compFit ?? 0.5);
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
 * failures (lol.ps or Data Dragon down, no matching lane data for that
 * candidate) just leave `build` unset for that entry. */
async function annotateWithBuild(picks: PickEntry[], position: Position): Promise<void> {
  const top = picks.slice(0, BUILD_CANDIDATE_LIMIT);
  if (top.length === 0) return;
  try {
    const [items, spells, runesData] = await Promise.all([
      getItemsWithCache(),
      getSummonerSpellsWithCache(),
      getRunesDataWithCache(),
    ]);
    const results = await Promise.allSettled(top.map((p) => getChampionBuild(p.championId, position)));
    results.forEach((r, i) => {
      if (r.status !== "fulfilled") return;
      const entry = top[i];
      entry.build = toBuildResult(
        { id: entry.championId, name: entry.name, iconUrl: entry.iconUrl },
        position,
        r.value,
        { items, spells, runes: runesData.runes, trees: runesData.trees },
      );
    });
  } catch {
    // Data Dragon or lol.ps unreachable — leave build fields unset.
  }
}

function toBrief(c: DDragonChampion): ChampionBrief {
  return { id: c.id, name: c.name, iconUrl: c.iconUrl };
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

  // Every enemy slot filled in so far (laner included) — feeds
  // rerankByEnemyCompFit below so "내 픽 추천" weighs in the full known
  // enemy roster, not just my direct lane opponent, per the tag-based
  // heuristic in teamComp.ts. Also reused for compHeuristic.enemy further
  // down, so it's computed once here instead of twice.
  const enemyChamps = POSITIONS.map((p) => slotChampion(`enemy-${p.value}`)).filter(
    (c): c is DDragonChampion => c !== null,
  );

  // --- single-pick recommendation for MY empty slot (unchanged logic from
  // before the draft board — just re-derived from the 10-slot params) ---
  let counterPicks: PickEntry[] | null = null;
  let counterError: string | null = null;
  if (enemyLaneChampion) {
    try {
      const result = await getAggregatedLaneCounters(enemyLaneChampion.slug, position, champions);
      const ranked = rerankByEnemyCompFit(toPickEntries(result, champById, "asc"), champById, enemyChamps, "asc");
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
      const result = await getAggregatedDuoCandidates(supportAdcChampion.slug, champions);
      const ranked = rerankByEnemyCompFit(toPickEntries(result, champById, "desc"), champById, enemyChamps, "desc");
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
            const fitScore = ((c.compFit ?? 0.5) + (s.compFit ?? 0.5)) / 2;
            const score = PICK_REAL_WEIGHT * realScore + PICK_FIT_WEIGHT * fitScore;
            return [
              {
                championId: c.championId,
                name: c.name,
                iconUrl: c.iconUrl,
                counterWinRate: c.winRate,
                counterGames: c.games,
                synergyWinRate: s.winRate,
                synergyGames: s.games,
                compFit: fitScore,
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
      const result = await getAggregatedDuoCandidates(duoAdc.slug, champions);
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
  // (enemyChamps was already computed above, before counterPicks/synergyPicks,
  // so rerankByEnemyCompFit could use it too — reused here as-is.) ---
  const allyChamps = POSITIONS.map((p) => slotChampion(`ally-${p.value}`)).filter(
    (c): c is DDragonChampion => c !== null,
  );
  const compHeuristic = {
    ally: analyzeTeamComp(allyChamps),
    enemy: analyzeTeamComp(enemyChamps),
  };

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
  });
}
