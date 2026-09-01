import { NextResponse } from "next/server";
import { getItemsWithCache } from "@/lib/ddragon";

/** Full item catalog for the "아이템 빌드" tab — filtered server-side to
 * items you can actually buy on Summoner's Rift, same "don't make the
 * client re-derive a server-only judgment call" convention as
 * /api/champions returning the already-resolved champion list. Everything
 * returned (name, icon, tags, cost, stats, plainDescription) comes straight
 * from Data Dragon's item.json — see DDragonItem, src/lib/ddragon.ts.
 *
 * Filters on top of purchasable/map availability, per user request
 * ("삭제된 아이템은 없애줘 그리고 하위 아이템도 없애줘", followed by "중복된
 * 아이템도 있고 대부분의 아이템이 빠져있고 삭제된 아이템도 많이 있어" once
 * that first pass was tested against the real deployed data):
 *   - `!hideFromAll` — item.json's own official flag for entries that
 *     shouldn't show up in a general item list (legacy/removed items kept
 *     around only so old match data/tooltips still resolve).
 *   - `!isComponentItem` — drops anything that still builds into something
 *     bigger (B.F. Sword, Cloak of Agility, ...), so the picker only offers
 *     finished/final-tier items.
 *   - `!isRestrictedVariant` — drops champion/ally-locked variants
 *     (`requiredChampion`/`requiredAlly`, e.g. Kalista's Black Spear, Ornn
 *     upgrades) that most builds can't actually buy — one real source of
 *     "duplicate"-looking tiles, since these often share their display name
 *     with an ordinary item.
 *   - A name-based dedup pass as a safety net on top of that: if two
 *     surviving entries still share the exact same `name` (Data Dragon can
 *     carry more than one id per name for reasons the three flags above
 *     don't all cover), only the first is kept.
 *
 * IMPORTANT CAVEAT: this session's sandbox has no outbound network access to
 * Data Dragon at all (confirmed — even a read-only fetch of
 * ddragon.leagueoflegends.com is blocked by the environment's egress proxy),
 * so none of the four rules above could be checked against the real current
 * item.json while writing them — they're built from Data Dragon's
 * documented field semantics only. If items are still missing, duplicated,
 * or clearly-removed ones still show up after this, the actual field values
 * for those specific items are needed to fix it correctly instead of
 * guessing again — see this file's git history/README for how to report
 * that (item names + ideally the raw `/api/items` JSON). */
export async function GET() {
  const items = await getItemsWithCache();
  const seenNames = new Set<string>();
  const list = Array.from(items.values())
    .filter(
      (it) =>
        it.cost.purchasable &&
        it.availableOnSummonersRift &&
        !it.hideFromAll &&
        !it.isComponentItem &&
        !it.isRestrictedVariant,
    )
    .sort((a, b) => a.name.localeCompare(b.name, "ko"))
    .filter((it) => {
      if (seenNames.has(it.name)) return false;
      seenNames.add(it.name);
      return true;
    });

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
