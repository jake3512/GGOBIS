// Community Dragon's own extracted game-data feed
// (https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/items.json)
// — a community-maintained mirror of Riot's client data files, pulled by
// the user directly as "the most accurate" source for item info. Unlike
// Riot's official Data Dragon `item.json` (see src/lib/ddragon.ts, still
// used for Korean name/icon/price/stats/description), this feed carries a
// few fields Data Dragon doesn't expose at all, which is exactly what this
// app needed after Data Dragon's own flags (`hideFromAll`/`purchasable`)
// kept mismatching the real current shop when tested against the deployed
// app ("중복된 아이템도 있고 대부분의 아이템이 빠져있고 삭제된 아이템도
// 많이 있어"):
//   - `inStore` (boolean) — whether the item is actually orderable in the
//     shop right now. More direct than piecing this together from Data
//     Dragon's `gold.purchasable`/`hideFromAll`, which is exactly the pair
//     that proved unreliable.
//   - `to` (number[]) — the items this one upgrades into. Data Dragon calls
//     the same concept `into` (string ids); Community Dragon uses numbers
//     and the name `to`. Non-empty means this is a component/recipe item,
//     not a finished one.
//   - `requiredChampion`/`requiredAlly` (string, empty when unrestricted) —
//     same concept as Data Dragon's fields of the same name, for
//     champion/ally-locked variants (Kalista's Black Spear, Ornn upgrades).
//
// IMPORTANT — none of this could be verified against a live response: this
// session's sandbox has outbound network access blocked for
// raw.communitydragon.org (confirmed via both WebFetch and a direct curl,
// same "organization policy" block that already applied to
// ddragon.leagueoflegends.com and namu.wiki). The shape below is built from
// this endpoint's long-standing, widely-referenced public schema, not a
// fetch this session actually made. It's wired in as a best-effort,
// additive signal for exactly that reason: getCommunityDragonItemFlags()
// never throws, and every call site falls back to the pre-existing
// Data-Dragon-flags/namu.wiki-allowlist logic for any item this feed
// doesn't have (or if the fetch fails outright) — so a schema mismatch here
// degrades gracefully instead of breaking the whole tab. If the real deploy
// shows items still misclassified, the actual response JSON (or even just
// one item's raw entry) is what's needed to correct the field names/shapes.

import { cached } from "@/lib/cache";

const ITEMS_URL =
  "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/items.json";

const CACHE_TTL_MS = 60 * 60 * 1000;

export interface CommunityDragonItemFlags {
  id: number;
  /** Whether this item is actually purchasable in the shop right now. */
  inStore: boolean;
  /** True when this item doesn't build into anything else (`to` empty) —
   * i.e. it's a finished/final-tier item, not a component/recipe step. */
  isFinalTier: boolean;
  /** True when `requiredChampion`/`requiredAlly` is set — a variant most
   * builds can't actually buy (e.g. Kalista's Black Spear, Ornn upgrades). */
  isRestrictedVariant: boolean;
}

interface RawCommunityDragonItem {
  id: number;
  inStore?: boolean;
  to?: number[];
  requiredChampion?: string;
  requiredAlly?: string;
}

async function fetchItemFlags(): Promise<Map<number, CommunityDragonItemFlags>> {
  const res = await fetch(ITEMS_URL, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; semips-lol-app/1.0; personal project, non-commercial)",
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`Community Dragon: items.json request failed (HTTP ${res.status}).`);
  }
  const body = (await res.json()) as unknown;
  if (!Array.isArray(body)) {
    throw new Error("Community Dragon: items.json response wasn't the expected array.");
  }
  const map = new Map<number, CommunityDragonItemFlags>();
  for (const raw of body as RawCommunityDragonItem[]) {
    if (typeof raw?.id !== "number") continue;
    map.set(raw.id, {
      id: raw.id,
      inStore: raw.inStore ?? false,
      isFinalTier: (raw.to?.length ?? 0) === 0,
      isRestrictedVariant: Boolean(raw.requiredChampion) || Boolean(raw.requiredAlly),
    });
  }
  return map;
}

/** Best-effort — never throws. Returns an empty map on any failure (network
 * down, unexpected response shape, ...) so callers can treat "no data for
 * this id" and "the whole fetch failed" the same way: fall back to
 * whatever other signal they already had for that item, same as this app's
 * other best-effort external calls (e.g. counterBuild in the counter tab). */
export async function getCommunityDragonItemFlags(): Promise<Map<number, CommunityDragonItemFlags>> {
  try {
    return await cached("communitydragon:items", CACHE_TTL_MS, fetchItemFlags);
  } catch {
    return new Map();
  }
}
