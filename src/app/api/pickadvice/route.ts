import { NextResponse } from "next/server";
import { getChampionsWithFallback, type DDragonChampion } from "@/lib/ddragon";
import { POSITIONS, type Position } from "@/lib/positions";
import { getAggregatedDuoCandidates, getAggregatedLaneCounters } from "@/lib/sources/aggregate";
import type { AggregatedCounters } from "@/lib/sources/aggregate";
import { getPowerCurvesForPosition } from "@/lib/sources/lolps";
import { analyzeTeamComp } from "@/lib/teamComp";

// Only the top handful of each recommendation list gets a power-curve
// lookup — the list itself can be 20-40 champions long, and fetching
// lol.ps's per-champion graphs.json for all of them on every request would
// be wasteful. The top picks are what the user actually looks at.
const POWER_CURVE_CANDIDATE_LIMIT = 5;

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

  // --- single-pick recommendation for MY empty slot (unchanged logic from
  // before the draft board — just re-derived from the 10-slot params) ---
  let counterPicks: PickEntry[] | null = null;
  let counterError: string | null = null;
  if (enemyLaneChampion) {
    try {
      const result = await getAggregatedLaneCounters(enemyLaneChampion.slug, position, champions);
      counterPicks = toPickEntries(result, champById, "asc");
      await annotateWithPowerCurve(counterPicks, position);
    } catch (err) {
      counterError = err instanceof Error ? err.message : "라인전 카운터 조회에 실패했습니다.";
    }
  }

  let synergyPicks: PickEntry[] | null = null;
  let synergyError: string | null = null;
  if (position === "support" && supportAdcChampion) {
    try {
      const result = await getAggregatedDuoCandidates(supportAdcChampion.slug, champions);
      synergyPicks = toPickEntries(result, champById, "desc");
      await annotateWithPowerCurve(synergyPicks, position);
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
            const score = (1 - c.winRate + s.winRate) / 2;
            return [
              {
                championId: c.championId,
                name: c.name,
                iconUrl: c.iconUrl,
                counterWinRate: c.winRate,
                counterGames: c.games,
                synergyWinRate: s.winRate,
                synergyGames: s.games,
                score,
              },
            ];
          })
          .sort((a, b) => b.score - a.score)
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
  // 사용하는, 승률과 무관한 보조 지표. src/lib/teamComp.ts 참고. ---
  const allyChamps = POSITIONS.map((p) => slotChampion(`ally-${p.value}`)).filter(
    (c): c is DDragonChampion => c !== null,
  );
  const enemyChamps = POSITIONS.map((p) => slotChampion(`enemy-${p.value}`)).filter(
    (c): c is DDragonChampion => c !== null,
  );
  const compHeuristic = {
    ally: analyzeTeamComp(allyChamps),
    enemy: analyzeTeamComp(enemyChamps),
  };

  return NextResponse.json({
    position,
    enemyLaneChampion: enemyLaneChampion ? toBrief(enemyLaneChampion) : null,
    allyAdcChampion: position === "support" && supportAdcChampion ? toBrief(supportAdcChampion) : null,
    counterPicks,
    counterError,
    synergyPicks,
    synergyError,
    combinedPicks,
    measuredSynergy,
    compHeuristic,
  });
}
