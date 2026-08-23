import { NextResponse } from "next/server";
import { getChampionsWithFallback } from "@/lib/ddragon";
import { POSITIONS, type Position } from "@/lib/positions";
import { getAggregatedLaneCounters } from "@/lib/sources/aggregate";

const VALID_POSITIONS = new Set(POSITIONS.map((p) => p.value));

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const championId = Number(searchParams.get("championId"));
  const position = searchParams.get("position") as Position | null;

  if (!Number.isInteger(championId)) {
    return NextResponse.json({ error: "championId query param is required" }, { status: 400 });
  }
  if (!position || !VALID_POSITIONS.has(position)) {
    return NextResponse.json(
      { error: `position must be one of: ${[...VALID_POSITIONS].join(", ")}` },
      { status: 400 },
    );
  }

  const champions = await getChampionsWithFallback();
  const champion = champions.find((c) => c.id === championId);
  if (!champion) {
    return NextResponse.json({ error: "Unknown championId" }, { status: 400 });
  }
  const champById = new Map(champions.map((c) => [c.id, c]));

  try {
    const result = await getAggregatedLaneCounters(champion.slug, position, champions);
    return NextResponse.json({
      champion: { id: champion.id, name: champion.name, iconUrl: champion.iconUrl },
      position,
      sourcesSucceeded: result.sourcesSucceeded,
      sourcesAttempted: result.sourcesAttempted,
      sourceErrors: result.errors,
      counters: result.entries
        .map((entry) => {
          const opponent = champById.get(entry.championId);
          if (!opponent) return null;
          return {
            championId: entry.championId,
            name: opponent.name,
            iconUrl: opponent.iconUrl,
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
        .filter((c) => c !== null)
        .sort((a, b) => a.winRate - b.winRate), // worst-for-us (best counters) first
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch counter data" },
      { status: 502 },
    );
  }
}
