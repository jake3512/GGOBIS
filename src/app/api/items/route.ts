import { NextResponse } from "next/server";
import { getCommunityDragonItems } from "@/lib/sources/communityDragonItems";

/** Full item catalog for the "아이템 빌드" tab — filtered server-side to
 * finished items you can actually buy on Summoner's Rift, same "don't make
 * the client re-derive a server-only judgment call" convention as
 * /api/champions returning the already-resolved champion list.
 *
 * Every field (name, icon, tags, cost, stats, description) and the
 * inclusion decision itself come ONLY from Community Dragon's items.json
 * (`getCommunityDragonItems`, src/lib/sources/communityDragonItems.ts) —
 * "아이템 빌드에서는 datadragon의 데이터를 쓰지 말아줘 모든 데이터를
 * 제시한 링크에서만 가져와줘". Data Dragon (src/lib/ddragon.ts) is not
 * consulted anywhere in this route anymore; it's still used elsewhere in
 * the app (the champion "빌드" tab, pick-advice's build cards) for an
 * unrelated feature, but this tab no longer falls back to it — this
 * followed a few earlier rounds where a Data-Dragon-flags/namu.wiki-name-
 * allowlist fallback was kept as a safety net, which the user then asked
 * to remove entirely in favor of a single, exclusive source.
 *
 * Inclusion rule: `inStore && isFinalTier && !isRestrictedVariant` — same
 * three checks as before, just no longer paired with any fallback. An item
 * this feed doesn't mark as in-store/final-tier/unrestricted (or that it
 * simply doesn't have at all) is excluded, full stop.
 *
 * A total fetch failure (Community Dragon unreachable, or an unexpected
 * response shape) surfaces as a 502 here rather than silently returning an
 * empty catalog — with no fallback left, there's no other way to tell
 * "genuinely no items" apart from "the source is down". */
export async function GET() {
  try {
    const cdItems = await getCommunityDragonItems();
    const list = Array.from(cdItems.values()).filter(
      (it) => it.inStore && it.isFinalTier && !it.isRestrictedVariant,
    );
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
