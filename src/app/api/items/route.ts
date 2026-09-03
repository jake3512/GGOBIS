import { NextResponse } from "next/server";
import { getItemsWithCache } from "@/lib/ddragon";
import { LEGENDARY_ITEM_NAMES } from "@/lib/legendaryItems";
import { getCommunityDragonItems } from "@/lib/sources/communityDragonItems";

/** Full item catalog for the "아이템 빌드" tab — filtered server-side to
 * items you can actually buy on Summoner's Rift, same "don't make the
 * client re-derive a server-only judgment call" convention as
 * /api/champions returning the already-resolved champion list.
 *
 * Two things per item, both preferring Community Dragon
 * (`getCommunityDragonItems`, src/lib/sources/communityDragonItems.ts —
 * the user pointed at this feed directly, first for inclusion and then for
 * "이름 가격 스탯도 제시한 링크에서 따와줘") over Data Dragon
 * (`getItemsWithCache`, src/lib/ddragon.ts) when it has data for that id,
 * after Data Dragon's own signals kept mismatching the real deployed shop
 * ("중복된 아이템도 있고 대부분의 아이템이 빠져있고 삭제된 아이템도 많이
 * 있어"):
 *
 *   1. **Whether to include it** — Community Dragon: `inStore &&
 *      isFinalTier && !isRestrictedVariant`. Falls back, only when
 *      Community Dragon has no entry for that id (its fetch failed
 *      outright, or that particular item isn't in its response), to the
 *      previous approach: the namu.wiki-sourced name allowlist
 *      (`LEGENDARY_ITEM_NAMES`) for legendaries — "저 탭에 있는 아이템은
 *      필수로 포함되게 해줘", name match alone is enough — and the old
 *      Data Dragon flag combo for boots. Anything else (basics,
 *      components, consumables, trinkets, wards, jungle items, ...) stays
 *      excluded either way — this tab models a *finished* 6-slot build,
 *      not the full shop.
 *   2. **Name / total price / stats** — Community Dragon's `name`/
 *      `priceTotal`/`stats` when present and non-empty, per-field; any
 *      field Community Dragon didn't have (or came back empty/zero for)
 *      falls back to Data Dragon's own value for that same field. Icon URL,
 *      tags, base/sell price, and the plain-text description always come
 *      from Data Dragon regardless — Community Dragon's feed doesn't cover
 *      those.
 *
 * A name-based dedup pass runs last regardless of which source's data an
 * item ended up with, in case two ids still collide on the same name. */
export async function GET() {
  const [items, cdItems] = await Promise.all([getItemsWithCache(), getCommunityDragonItems()]);

  const included = Array.from(items.values()).filter((it) => {
    const cd = cdItems.get(it.id);
    if (cd) return cd.inStore && cd.isFinalTier && !cd.isRestrictedVariant;
    if (it.tags.includes("Boots")) {
      return it.cost.purchasable && it.availableOnSummonersRift && !it.hideFromAll && !it.isComponentItem && !it.isRestrictedVariant;
    }
    return LEGENDARY_ITEM_NAMES.has(it.name);
  });

  const merged = included.map((it) => {
    const cd = cdItems.get(it.id);
    return {
      id: it.id,
      name: cd?.name || it.name,
      iconUrl: it.iconUrl,
      tags: it.tags,
      cost: { base: it.cost.base, total: cd?.priceTotal || it.cost.total, sell: it.cost.sell },
      stats: cd && Object.keys(cd.stats).length > 0 ? cd.stats : it.stats,
      plainDescription: it.plainDescription,
    };
  });

  merged.sort((a, b) => a.name.localeCompare(b.name, "ko"));
  const seenNames = new Set<string>();
  const deduped = merged.filter((it) => {
    if (seenNames.has(it.name)) return false;
    seenNames.add(it.name);
    return true;
  });

  return NextResponse.json({ items: deduped });
}
