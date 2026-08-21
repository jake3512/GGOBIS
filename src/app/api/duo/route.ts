import { NextResponse } from "next/server";
import { getChampionsWithFallback } from "@/lib/ddragon";
import { getBotDuoSynergy } from "@/lib/opgg";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const adcId = Number(searchParams.get("adcId"));
  const supportId = Number(searchParams.get("supportId"));

  if (!Number.isInteger(adcId) || !Number.isInteger(supportId)) {
    return NextResponse.json(
      { error: "adcId and supportId query params are required" },
      { status: 400 },
    );
  }

  const champions = await getChampionsWithFallback();
  const adc = champions.find((c) => c.id === adcId);
  const support = champions.find((c) => c.id === supportId);
  if (!adc || !support) {
    return NextResponse.json({ error: "Unknown adcId or supportId" }, { status: 400 });
  }

  try {
    const result = await getBotDuoSynergy(adc.slug, support.slug, support.id);
    return NextResponse.json({
      adc: { id: adc.id, name: adc.name, iconUrl: adc.iconUrl },
      support: { id: support.id, name: support.name, iconUrl: support.iconUrl },
      sourceUrl: result.sourceUrl,
      winRate: result.winRate,
      games: result.games,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch data from op.gg" },
      { status: 502 },
    );
  }
}
