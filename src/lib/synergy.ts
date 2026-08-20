import { prisma } from "@/lib/db";

// Bayesian smoothing pulls low-sample-size pairs toward a neutral 50%
// instead of letting e.g. a 2-game 100% "win rate" outrank a proven
// 500-game 55% one. PRIOR_GAMES is how many "phantom" 50%-win games we mix
// in — higher = more conservative for thin data.
const PRIOR_GAMES = 20;
const PRIOR_RATE = 0.5;

export function smoothedWinRate(wins: number, games: number): number {
  return (wins + PRIOR_GAMES * PRIOR_RATE) / (games + PRIOR_GAMES);
}

export interface TeammateRecommendation {
  championId: number;
  score: number; // smoothed average synergy win rate with the selected champions
  totalGames: number; // sum of sample sizes backing that average (0 if never seen together)
}

/** Given 1-4 already-picked champions, rank the remaining champions by how
 * well they've historically performed on the same team as all of them. */
export async function recommendTeammates(
  selectedIds: number[],
  limit = 15,
): Promise<TeammateRecommendation[]> {
  const allChampions = await prisma.champion.findMany({ select: { id: true } });
  const candidateIds = allChampions
    .map((c) => c.id)
    .filter((id) => !selectedIds.includes(id));

  const pairRows = await prisma.championPairStat.findMany({
    where: {
      OR: [{ championAId: { in: selectedIds } }, { championBId: { in: selectedIds } }],
    },
  });
  const pairMap = new Map<string, { games: number; wins: number }>();
  for (const row of pairRows) {
    pairMap.set(pairKey(row.championAId, row.championBId), row);
  }

  const results: TeammateRecommendation[] = candidateIds.map((candidateId) => {
    let scoreSum = 0;
    let totalGames = 0;
    for (const sel of selectedIds) {
      const row = pairMap.get(pairKey(candidateId, sel));
      const games = row?.games ?? 0;
      const wins = row?.wins ?? 0;
      scoreSum += smoothedWinRate(wins, games);
      totalGames += games;
    }
    return { championId: candidateId, score: scoreSum / selectedIds.length, totalGames };
  });

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

function pairKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

export interface TeamEvaluation {
  synergyScore: number; // average smoothed win rate across all 10 pairs in the team
  pairBreakdown: { championAId: number; championBId: number; score: number; games: number }[];
}

export async function evaluateTeam(teamIds: number[]): Promise<TeamEvaluation> {
  const rows = await prisma.championPairStat.findMany({
    where: { OR: [{ championAId: { in: teamIds } }, { championBId: { in: teamIds } }] },
  });
  const pairMap = new Map<string, { games: number; wins: number }>();
  for (const row of rows) pairMap.set(pairKey(row.championAId, row.championBId), row);

  const pairBreakdown: TeamEvaluation["pairBreakdown"] = [];
  for (let i = 0; i < teamIds.length; i++) {
    for (let j = i + 1; j < teamIds.length; j++) {
      const a = teamIds[i];
      const b = teamIds[j];
      const row = pairMap.get(pairKey(a, b));
      const games = row?.games ?? 0;
      const wins = row?.wins ?? 0;
      pairBreakdown.push({ championAId: a, championBId: b, score: smoothedWinRate(wins, games), games });
    }
  }

  const synergyScore =
    pairBreakdown.reduce((sum, p) => sum + p.score, 0) / pairBreakdown.length;
  return { synergyScore, pairBreakdown };
}

export interface CounterPick {
  championId: number;
  score: number; // smoothed average win rate against every champion in the target team
}

/** Rank every champion NOT in `targetTeamIds` by average win rate against
 * each member of that team (a pure "best individual counters" list). */
export async function rankCounterPicks(
  targetTeamIds: number[],
  limit = 15,
  excludeIds: number[] = [],
): Promise<CounterPick[]> {
  const allChampions = await prisma.champion.findMany({ select: { id: true } });
  const excluded = new Set([...targetTeamIds, ...excludeIds]);
  const candidateIds = allChampions.map((c) => c.id).filter((id) => !excluded.has(id));

  const rows = await prisma.championMatchupStat.findMany({
    where: { championBId: { in: targetTeamIds }, championAId: { in: candidateIds } },
  });
  const byCandidate = new Map<number, { championBId: number; games: number; winsA: number }[]>();
  for (const row of rows) {
    const list = byCandidate.get(row.championAId) ?? [];
    list.push(row);
    byCandidate.set(row.championAId, list);
  }

  const results: CounterPick[] = candidateIds.map((candidateId) => {
    const rowsForCandidate = byCandidate.get(candidateId) ?? [];
    // Missing matchups (never observed) default to a neutral 50% via smoothedWinRate(0, 0).
    const scores = targetTeamIds.map((enemyId) => {
      const row = rowsForCandidate.find((r) => r.championBId === enemyId);
      return smoothedWinRate(row?.winsA ?? 0, row?.games ?? 0);
    });
    const score = scores.reduce((s, v) => s + v, 0) / scores.length;
    return { championId: candidateId, score };
  });

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

export interface ComposedCounterTeam {
  team: { championId: number; counterScore: number; synergyWithTeamSoFar: number | null }[];
  avgCounterScore: number;
  synergyScore: number;
}

// How much weight a candidate's matchup advantage vs. the target team gets,
// relative to how well it synergizes with counter-team picks made so far.
const COUNTER_WEIGHT = 0.7;
const SYNERGY_WEIGHT = 0.3;

/** Greedily builds a full 5-champion team that both counters `targetTeamIds`
 * and has reasonable internal synergy, picking one champion at a time. */
export async function composeCounterTeam(targetTeamIds: number[]): Promise<ComposedCounterTeam> {
  const picked: number[] = [];
  const teamRows: ComposedCounterTeam["team"] = [];

  for (let slot = 0; slot < 5; slot++) {
    const counters = await rankCounterPicks(targetTeamIds, 200, picked);
    if (counters.length === 0) break;

    let best = counters[0];
    let bestCombined = -Infinity;
    let bestSynergy: number | null = null;

    if (picked.length === 0) {
      best = counters[0];
    } else {
      const pairRows = await prisma.championPairStat.findMany({
        where: { OR: [{ championAId: { in: picked } }, { championBId: { in: picked } }] },
      });
      const pairMap = new Map<string, { games: number; wins: number }>();
      for (const row of pairRows) pairMap.set(pairKey(row.championAId, row.championBId), row);

      for (const c of counters) {
        let synergySum = 0;
        for (const p of picked) {
          const row = pairMap.get(pairKey(c.championId, p));
          synergySum += smoothedWinRate(row?.wins ?? 0, row?.games ?? 0);
        }
        const avgSynergy = synergySum / picked.length;
        const combined = COUNTER_WEIGHT * c.score + SYNERGY_WEIGHT * avgSynergy;
        if (combined > bestCombined) {
          bestCombined = combined;
          best = c;
          bestSynergy = avgSynergy;
        }
      }
    }

    picked.push(best.championId);
    teamRows.push({
      championId: best.championId,
      counterScore: best.score,
      synergyWithTeamSoFar: bestSynergy,
    });
  }

  const avgCounterScore = teamRows.reduce((s, t) => s + t.counterScore, 0) / teamRows.length;
  const { synergyScore } = await evaluateTeam(picked);

  return { team: teamRows, avgCounterScore, synergyScore };
}
