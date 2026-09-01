import { NextResponse } from "next/server";
import { getItemsWithCache } from "@/lib/ddragon";

/** Full item catalog for the "아이템 빌드" tab — filtered server-side to
 * items you can actually buy on Summoner's Rift, same "don't make the
 * client re-derive a server-only judgment call" convention as
 * /api/champions returning the already-resolved champion list. Everything
 * returned (name, icon, tags, cost, stats, plainDescription) comes straight
 * from Data Dragon's item.json — see DDragonItem, src/lib/ddragon.ts. */
export async function GET() {
  const items = await getItemsWithCache();
  const list = Array.from(items.values())
    .filter((it) => it.cost.purchasable && it.availableOnSummonersRift)
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));

  return NextResponse.json({
    items: list.map((it) => ({
      id: it.id,
      name: it.name,
      iconUrl: it.iconUrl,
      tags: it.tags,
      cost: { base: it.cost.base, total: it.cost.total, sell: it.cost.sell },
      stats: it.stats,
      plainDescription: it.plainDescription,
    })),
  });
}
