import { NextResponse } from "next/server";
import { getItemsWithCache } from "@/lib/ddragon";
import { LEGENDARY_ITEM_NAMES } from "@/lib/legendaryItems";
import { getCommunityDragonItemFlags } from "@/lib/sources/communityDragonItems";

/** Full item catalog for the "아이템 빌드" tab — filtered server-side to
 * items you can actually buy on Summoner's Rift, same "don't make the
 * client re-derive a server-only judgment call" convention as
 * /api/champions returning the already-resolved champion list. Name/icon/
 * price/stats/description always come from Data Dragon (see DDragonItem,
 * src/lib/ddragon.ts) — only the "should this item even be in the list"
 * decision below has changed across a few rounds of this not matching the
 * real deployed shop ("중복된 아이템도 있고 대부분의 아이템이 빠져있고
 * 삭제된 아이템도 많이 있어"):
 *
 *   1. **Community Dragon, per item, when available** (`getCommunityDragonItemFlags`,
 *      src/lib/sources/communityDragonItems.ts — the user pointed at this
 *      feed directly as the source to collect from): `inStore &&
 *      isFinalTier && !isRestrictedVariant`. This is the primary check for
 *      every item, legendary or boots alike, because Community Dragon's
 *      `inStore` is a much more direct "can you actually buy this right
 *      now" signal than anything Data Dragon exposes.
 *   2. **Fallback when Community Dragon has no data for that id** (its own
 *      fetch failed, or that particular item isn't in its response) — the
 *      previous approach, kept as a safety net rather than removed:
 *      - Legendary items: the namu.wiki-sourced name allowlist
 *        (`LEGENDARY_ITEM_NAMES`, src/lib/legendaryItems.ts) — "저 탭에
 *        있는 아이템은 필수로 포함되게 해줘", name match alone is enough.
 *      - Boots: the old Data Dragon flag combo (`purchasable &&
 *        availableOnSummonersRift && !hideFromAll && !isComponentItem &&
 *        !isRestrictedVariant`).
 *      - Anything else (basics, components, consumables, trinkets, wards,
 *        jungle items, ...) stays excluded either way — this tab models a
 *        *finished* 6-slot build, not the full shop.
 *
 * A name-based dedup pass runs last regardless of which check let an item
 * through, in case Data Dragon still carries more than one id for the same
 * name. */
export async function GET() {
  const [items, cdFlags] = await Promise.all([getItemsWithCache(), getCommunityDragonItemFlags()]);
  const list = Array.from(items.values()).filter((it) => {
    const cd = cdFlags.get(it.id);
    if (cd) return cd.inStore && cd.isFinalTier && !cd.isRestrictedVariant;
    if (it.tags.includes("Boots")) {
      return it.cost.purchasable && it.availableOnSummonersRift && !it.hideFromAll && !it.isComponentItem && !it.isRestrictedVariant;
    }
    return LEGENDARY_ITEM_NAMES.has(it.name);
  });
  list.sort((a, b) => a.name.localeCompare(b.name, "ko"));
  const seenNames = new Set<string>();
  const deduped = list.filter((it) => {
    if (seenNames.has(it.name)) return false;
    seenNames.add(it.name);
    return true;
  });

  return NextResponse.json({
    items: deduped.map((it) => ({
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
