import { NextResponse } from "next/server";
import { getItemsWithCache } from "@/lib/ddragon";
import { LEGENDARY_ITEM_NAMES } from "@/lib/legendaryItems";

/** Full item catalog for the "아이템 빌드" tab — filtered server-side to
 * items you can actually buy on Summoner's Rift, same "don't make the
 * client re-derive a server-only judgment call" convention as
 * /api/champions returning the already-resolved champion list. Everything
 * returned (name, icon, tags, cost, stats, plainDescription) comes straight
 * from Data Dragon's item.json — see DDragonItem, src/lib/ddragon.ts.
 *
 * Two very different filtering strategies, split by item kind, after Data
 * Dragon's own flags alone (`hideFromAll`/`isComponentItem`/
 * `requiredChampion`/`requiredAlly`) proved unreliable once actually tested
 * against the real deployed data ("중복된 아이템도 있고 대부분의 아이템이
 * 빠져있고 삭제된 아이템도 많이 있어"):
 *   - **Legendary (완성) items**: gated by an explicit name allowlist
 *     (`LEGENDARY_ITEM_NAMES`, src/lib/legendaryItems.ts) instead of Data
 *     Dragon flags — the user pointed at namu.wiki's own curated "전설
 *     아이템" list as the accurate source of truth and had it transcribed
 *     in directly, so this only shows a legendary if its exact name is on
 *     that list. See that file for the transcription-accuracy caveat.
 *   - **Boots**: namu.wiki's list doesn't cover boots (a separate category),
 *     so these still go through the old flag-based filter
 *     (`purchasable && availableOnSummonersRift && !hideFromAll &&
 *     !isComponentItem && !isRestrictedVariant`) — boots weren't reported as
 *     having the duplicate/missing/removed problems the legendaries had.
 *   - Everything else (basics, epics/components, consumables, trinkets,
 *     wards, jungle items, ...) is intentionally left out — this tab models
 *     a *finished* 6-slot build (legendaries + boots), not the full shop. */
export async function GET() {
  const items = await getItemsWithCache();
  const list = Array.from(items.values()).filter((it) => {
    if (it.tags.includes("Boots")) {
      return it.cost.purchasable && it.availableOnSummonersRift && !it.hideFromAll && !it.isComponentItem && !it.isRestrictedVariant;
    }
    return it.cost.purchasable && it.availableOnSummonersRift && LEGENDARY_ITEM_NAMES.has(it.name);
  });
  list.sort((a, b) => a.name.localeCompare(b.name, "ko"));

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
