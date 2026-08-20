import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { recommendTeammates } from "@/lib/synergy";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const championIds = body?.championIds;

  if (
    !Array.isArray(championIds) ||
    championIds.length < 1 ||
    championIds.length > 4 ||
    !championIds.every((id) => Number.isInteger(id)) ||
    new Set(championIds).size !== championIds.length
  ) {
    return NextResponse.json(
      { error: "championIds must be an array of 1-4 unique integers" },
      { status: 400 },
    );
  }

  const known = await prisma.champion.findMany({
    where: { id: { in: championIds } },
    select: { id: true },
  });
  if (known.length !== championIds.length) {
    return NextResponse.json({ error: "Unknown champion id in championIds" }, { status: 400 });
  }

  const recommendations = await recommendTeammates(championIds, 15);
  const champions = await prisma.champion.findMany({
    where: { id: { in: recommendations.map((r) => r.championId) } },
  });
  const champById = new Map(champions.map((c) => [c.id, c]));

  return NextResponse.json({
    recommendations: recommendations.map((r) => {
      const champ = champById.get(r.championId)!;
      return {
        championId: r.championId,
        name: champ.name,
        iconUrl: champ.iconUrl,
        tags: champ.tags.split(","),
        winRate: r.score,
        sampleGames: r.totalGames,
      };
    }),
  });
}
