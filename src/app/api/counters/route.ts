import { NextResponse } from "next/server";
import { getChampionsWithFallback } from "@/lib/ddragon";
import { getLaneCounters, POSITIONS, type Position } from "@/lib/opgg";

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
    const result = await getLaneCounters(champion.slug, position);
    return NextResponse.json({
      champion: { id: champion.id, name: champion.name, iconUrl: champion.iconUrl },
      position,
      sourceUrl: result.sourceUrl,
      counters: result.counters
        .map((c) => {
          const opponent = champById.get(c.championId);
          if (!opponent) return null;
          return {
            championId: c.championId,
            name: opponent.name,
            iconUrl: opponent.iconUrl,
            winRate: c.winRate,
            games: c.games,
          };
        })
        .filter((c) => c !== null)
        .sort((a, b) => a.winRate - b.winRate), // worst-for-us (best counters) first
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch data from op.gg" },
      { status: 502 },
    );
  }
}
