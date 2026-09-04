import { NextResponse } from "next/server";
import { getCommunityDragonItems } from "@/lib/sources/communityDragonItems";

/** Full item catalog for the "아이템 빌드" tab — filtered server-side to
 * finished items you can actually buy, same "don't make the client re-derive
 * a server-only judgment call" convention as /api/champions returning the
 * already-resolved champion list.
 *
 * Every field (name, icon, tags, cost, stats, description) and the
 * inclusion decision itself come ONLY from Community Dragon's items.json —
 * "아이템 빌드에서는 datadragon의 데이터를 쓰지 말아줘 모든 데이터를 제시한
 * 링크에서만 가져와줘" — now read from a bundled, verified static dump
 * rather than a live fetch (`getCommunityDragonItems`,
 * src/lib/sources/communityDragonItems.ts — "데이터베이스를 이걸로
 * 교체해줘", see that file's header for the full story). Data Dragon
 * (src/lib/ddragon.ts) is not consulted anywhere in this route; it's still
 * used elsewhere in the app (champion "빌드" tab, pick-advice build cards)
 * for an unrelated feature.
 *
 * Inclusion rule: `inStore && isFinalTier && !isRestrictedVariant &&
 * tags.length > 0 && cost.total > 0`. The last two checks are new, once real
 * data was available to check against:
 *  - 67 entries in the bundled dump (URF/Arena champion-power items,
 *    game-mode placeholder vouchers, junk) all share an EMPTY `categories`
 *    array despite otherwise passing the first three checks — every genuine
 *    buildable item has at least one category, so this drops that whole
 *    class cleanly without guessing at names.
 *  - A further 18 entries (internal quest trackers like "Quest: Top",
 *    system entries like "Healthbar Splash: Blue", special-mode consumables
 *    like "AD Rune Replacer") have `cost.total === 0` — this also happens
 *    to be the trinkets (Stealth Ward/Farsight Alteration/Oracle Lens),
 *    which this tab already excludes on purpose ("장신구는 가격/스탯이
 *    의미 없어서 뺐습니다"), so the zero-cost check is consistent with that
 *    existing design intent rather than a new exception to it.
 *
 * DEDUP: real data showed the SAME item name appearing under multiple ids
 * for different game modes (e.g. "Infinity Edge" as 3031/223031/773031 —
 * normal/ARAM/Arena rebalances, no per-item mode field to check instead).
 * The lowest id among same-named entries is consistently the normal
 * Summoner's Rift version in every case checked, so duplicates are resolved
 * by keeping the MINIMUM id per name — deterministic regardless of the
 * source array's order, unlike the previous "keep whichever appears first"
 * rule. A handful of special-mode items without a normal-SR name collision
 * may still slip through (there's no ground-truth mode flag to check
 * against) — if one turns up, tell me the name and it's a one-line fix.
 *
 * This route can no longer fail with a network/fetch error (the data is
 * bundled, not fetched), but a try/catch is kept for any unexpected parse
 * issue rather than assuming that's now impossible. */
export async function GET() {
  try {
    const cdItems = await getCommunityDragonItems();
    const eligible = Array.from(cdItems.values()).filter(
      (it) => it.inStore && it.isFinalTier && !it.isRestrictedVariant && it.tags.length > 0 && it.cost.total > 0,
    );

    const lowestIdByName = new Map<string, number>();
    for (const it of eligible) {
      const current = lowestIdByName.get(it.name);
      if (current === undefined || it.id < current) lowestIdByName.set(it.name, it.id);
    }
    const deduped = eligible.filter((it) => lowestIdByName.get(it.name) === it.id);
    deduped.sort((a, b) => a.name.localeCompare(b.name, "ko"));

    return NextResponse.json({
      items: deduped.map((it) => ({
        id: it.id,
        name: it.name,
        iconUrl: it.iconUrl,
        tags: it.tags,
        cost: it.cost,
        stats: it.stats,
        plainDescription: it.plainDescription,
      })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "아이템 목록을 가져오지 못했습니다." },
      { status: 502 },
    );
  }
}
