import { NextResponse } from "next/server";
import { getChampionsWithFallback } from "@/lib/ddragon";

export async function GET() {
  const champions = await getChampionsWithFallback();
  return NextResponse.json({
    champions: champions.map((c) => ({
      id: c.id,
      slug: c.slug,
      name: c.name,
      title: c.title,
      iconUrl: c.iconUrl,
      tags: c.tags,
    })),
  });
}
