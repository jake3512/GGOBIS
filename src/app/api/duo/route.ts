import { NextResponse } from "next/server";
import { getChampionsWithFallback } from "@/lib/ddragon";
import { getAggregatedDuoSynergy } from "@/lib/sources/aggregate";

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
    // This tab is always specifically ADC+Support — "adc" is the ADC's own
    // position, matching getAggregatedDuoSynergy's new (slug, position,
    // partnerSlug, partnerChampionId, champions) signature.
    const result = await getAggregatedDuoSynergy(adc.slug, "adc", support.slug, support.id, champions);
    return NextResponse.json({
      adc: { id: adc.id, name: adc.name, iconUrl: adc.iconUrl },
      support: { id: support.id, name: support.name, iconUrl: support.iconUrl },
      sourcesSucceeded: result.sourcesSucceeded,
      sourcesAttempted: result.sourcesAttempted,
      sourceErrors: result.errors,
      bySource: result.bySource.map((s) => ({
        sourceId: s.sourceId,
        sourceLabel: s.sourceLabel,
        winRate: s.winRate,
        games: s.games,
      })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch duo data" },
      { status: 502 },
    );
  }
}
