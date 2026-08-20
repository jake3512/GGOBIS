import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  const champions = await prisma.champion.findMany({ orderBy: { name: "asc" } });
  return NextResponse.json({
    champions: champions.map((c) => ({
      id: c.id,
      name: c.name,
      title: c.title,
      iconUrl: c.iconUrl,
      tags: c.tags.split(","),
    })),
  });
}
