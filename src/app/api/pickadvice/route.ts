import { NextResponse } from "next/server";
import { getChampionsWithFallback, type DDragonChampion } from "@/lib/ddragon";
import { POSITIONS, type Position } from "@/lib/positions";
import { getAggregatedDuoCandidates, getAggregatedLaneCounters } from "@/lib/sources/aggregate";
import type { AggregatedCounters } from "@/lib/sources/aggregate";

const VALID_POSITIONS = new Set(POSITIONS.map((p) => p.value));

interface PickEntry {
  championId: number;
  name: string;
  iconUrl: string;
  winRate: number;
  games: number;
  bySource: { sourceId: string; sourceLabel: string; winRate: number; games: number }[];
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

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const position = searchParams.get("position") as Position | null;
  const enemyLaneChampionIdRaw = searchParams.get("enemyLaneChampionId");
  const allyAdcChampionIdRaw = searchParams.get("allyAdcChampionId");

  if (!position || !VALID_POSITIONS.has(position)) {
    return NextResponse.json(
      { error: `position must be one of: ${[...VALID_POSITIONS].join(", ")}` },
      { status: 400 },
    );
  }

  const enemyLaneChampionId = enemyLaneChampionIdRaw ? Number(enemyLaneChampionIdRaw) : null;
  const allyAdcChampionId =
    position === "support" && allyAdcChampionIdRaw ? Number(allyAdcChampionIdRaw) : null;

  if (enemyLaneChampionId === null && allyAdcChampionId === null) {
    return NextResponse.json(
      { error: "상대 라이너 또는 우리팀 원거리 딜러 중 최소 하나는 입력해야 합니다." },
      { status: 400 },
    );
  }

  const champions = await getChampionsWithFallback();
  const champById = new Map(champions.map((c) => [c.id, c]));

  const enemyLaneChampion =
    enemyLaneChampionId !== null ? (champById.get(enemyLaneChampionId) ?? null) : null;
  const allyAdcChampion =
    allyAdcChampionId !== null ? (champById.get(allyAdcChampionId) ?? null) : null;

  if (enemyLaneChampionId !== null && !enemyLaneChampion) {
    return NextResponse.json({ error: "Unknown enemyLaneChampionId" }, { status: 400 });
  }
  if (allyAdcChampionId !== null && !allyAdcChampion) {
    return NextResponse.json({ error: "Unknown allyAdcChampionId" }, { status: 400 });
  }

  let counterPicks: PickEntry[] | null = null;
  let counterError: string | null = null;
  if (enemyLaneChampion) {
    try {
      const result = await getAggregatedLaneCounters(enemyLaneChampion.slug, position, champions);
      counterPicks = toPickEntries(result, champById, "asc");
    } catch (err) {
      counterError = err instanceof Error ? err.message : "라인전 카운터 조회에 실패했습니다.";
    }
  }

  let synergyPicks: PickEntry[] | null = null;
  let synergyError: string | null = null;
  if (allyAdcChampion) {
    try {
      const result = await getAggregatedDuoCandidates(allyAdcChampion.slug, champions);
      synergyPicks = toPickEntries(result, champById, "desc");
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

  return NextResponse.json({
    position,
    enemyLaneChampion: enemyLaneChampion
      ? { id: enemyLaneChampion.id, name: enemyLaneChampion.name, iconUrl: enemyLaneChampion.iconUrl }
      : null,
    allyAdcChampion: allyAdcChampion
      ? { id: allyAdcChampion.id, name: allyAdcChampion.name, iconUrl: allyAdcChampion.iconUrl }
      : null,
    counterPicks,
    counterError,
    synergyPicks,
    synergyError,
    combinedPicks,
  });
}
