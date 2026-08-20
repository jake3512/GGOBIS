import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { composeCounterTeam, evaluateTeam, rankCounterPicks } from "@/lib/synergy";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const team = body?.team;

  if (
    !Array.isArray(team) ||
    team.length !== 5 ||
    !team.every((id) => Number.isInteger(id)) ||
    new Set(team).size !== 5
  ) {
    return NextResponse.json(
      { error: "team must be an array of exactly 5 unique integers" },
      { status: 400 },
    );
  }

  const known = await prisma.champion.findMany({
    where: { id: { in: team } },
    select: { id: true },
  });
  if (known.length !== 5) {
    return NextResponse.json({ error: "Unknown champion id in team" }, { status: 400 });
  }

  const [evaluation, topCounterPicks, composedCounter] = await Promise.all([
    evaluateTeam(team),
    rankCounterPicks(team, 10),
    composeCounterTeam(team),
  ]);

  const relevantIds = new Set<number>([
    ...team,
    ...topCounterPicks.map((c) => c.championId),
    ...composedCounter.team.map((c) => c.championId),
  ]);
  const champions = await prisma.champion.findMany({ where: { id: { in: [...relevantIds] } } });
  const champById = new Map(champions.map((c) => [c.id, c]));
  const brief = (id: number) => {
    const c = champById.get(id)!;
    return { championId: id, name: c.name, iconUrl: c.iconUrl, tags: c.tags.split(",") };
  };

  return NextResponse.json({
    team: team.map(brief),
    synergyScore: evaluation.synergyScore,
    pairBreakdown: evaluation.pairBreakdown.map((p) => ({
      championA: brief(p.championAId),
      championB: brief(p.championBId),
      winRate: p.score,
      sampleGames: p.games,
    })),
    topCounterPicks: topCounterPicks.map((c) => ({ ...brief(c.championId), winRate: c.score })),
    composedCounterTeam: {
      synergyScore: composedCounter.synergyScore,
      avgCounterScore: composedCounter.avgCounterScore,
      team: composedCounter.team.map((t) => ({
        ...brief(t.championId),
        counterWinRate: t.counterScore,
        synergyWithTeamSoFar: t.synergyWithTeamSoFar,
      })),
    },
  });
}
