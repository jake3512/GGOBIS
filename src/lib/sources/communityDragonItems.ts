// Community Dragon's own extracted game-data feed, pulled by the user
// directly:
//   https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/items.json
// — a community-maintained mirror of Riot's client data files.
//
// This is now the ONLY data source for the "아이템 빌드" tab
// (/api/items) — "아이템 빌드에서는 datadragon의 데이터를 쓰지 말아줘
// 모든 데이터를 제시한 링크에서만 가져와줘". Everything the tab shows
// (name, icon, tags, price, stats, description, and the "should this item
// even be in the list" decision) is derived from this one feed; Data
// Dragon's item.json (src/lib/ddragon.ts) is no longer consulted anywhere
// in that tab's code path — it's still used elsewhere in the app (the
// champion "빌드" tab, pick-advice's build cards) for an unrelated feature.
//
// Fields used, and what each maps onto below:
//   - `inStore` (boolean) — whether the item is actually orderable in the
//     shop right now.
//   - `to` (number[]) — the items this one upgrades into; non-empty means
//     it's a component/recipe item, not a finished one (`isFinalTier`).
//   - `requiredChampion`/`requiredAlly` (string, empty when unrestricted) —
//     champion/ally-locked variants (Kalista's Black Spear, Ornn upgrades).
//   - `name` — display name.
//   - `iconPath` (e.g. "/lol-game-data/assets/ASSETS/Items/Icons2D/
//     3031_infinityedge.png") — converted to a fetchable URL under
//     Community Dragon's own asset CDN (`toAssetUrl` below): the
//     "/lol-game-data/assets/" prefix is stripped and the remaining path is
//     lowercased, per this feed's well-known asset-serving convention.
//   - `categories` (string[]) — same concept as Data Dragon's `tags`
//     (e.g. "Boots", "CriticalStrike").
//   - `price` / `priceTotal` — combine-only cost / full total cost, the
//     same base-vs-total split Data Dragon's `gold.base`/`gold.total` make.
//     There's no explicit sell-price field in this feed's schema, so
//     `cost.sell` is DERIVED (not sourced) as 70% of `priceTotal`, rounded —
//     League's standard sell-back ratio for buildable items, not a value
//     read out of the response.
//   - `simpleDescription` — short plain-text summary, same role Data
//     Dragon's `plaintext` played.
//   - `maps` (object keyed by map id string, e.g. `{"11": true, "12": false,
//     ...}`) — per-map availability, same concept Data Dragon's
//     `maps["11"]` used to gate `availableOnSummonersRift` before this tab
//     dropped Data Dragon entirely. "11" is Summoner's Rift's map id (Riot's
//     own numbering, unrelated to this feed). Added for "현재 협곡에서 쓸 수
//     있는 아이템만 넣어줘" — `inStore` alone doesn't distinguish an item
//     that's purchasable somewhere (ARAM/Arena-only items, say) from one
//     actually buyable on Summoner's Rift specifically.
//   - `stats` (object, keyed by camelCase stat concept e.g.
//     "abilityPower"/"attackSpeed"/"lethality"/"omnivamp", each a
//     `{flat?, percent?}`-shaped block) — covers several stats Data
//     Dragon's own `stats` block never included at all (Ability Haste,
//     Lethality, Omnivamp, Physical/Spell Vamp, Tenacity, Heal & Shield
//     Power, Armor/Magic Penetration). Normalized below onto the same
//     `Flat*Mod`/`Percent*Mod` key style Data Dragon used to use, via
//     CD_STAT_KEY_MAP, so src/lib/itemStats.ts's existing label/filter
//     table keeps working unchanged.
//
// LOCALE: the URL the user gave points at "global/default" — Community
// Dragon's convention for the un-localized (English) copy of the data; the
// same path with "default" swapped for a locale code (e.g. "ko_kr") serves
// a translated copy with identical non-text fields (inStore/to/price/stats
// are locale-independent, only name/description change). Since this app's
// entire UI is Korean, this file tries the "ko_kr" path FIRST — same
// underlying Community Dragon data the user pointed at, just the localized
// variant of it — and only falls back to the exact "global/default" URL
// given (English names) if that request itself fails.
//
// IMPORTANT — none of this could be verified against a live response: this
// session's sandbox has outbound network access blocked for
// raw.communitydragon.org (confirmed via both WebFetch and a direct curl,
// same "organization policy" block that already applied to
// ddragon.leagueoflegends.com and namu.wiki). The shape below is built from
// this endpoint's long-standing, widely-referenced public schema, not a
// fetch this session actually made. Since this is now the tab's ONLY
// source (no Data Dragon fallback left), getCommunityDragonItems() throws
// on total failure instead of swallowing it — /api/items turns that into a
// clear 502 rather than silently showing an empty "no items" list that
// looks the same as a legitimately-empty catalog. If the real deploy shows
// wrong/missing fields, the actual response JSON (or even just one item's
// raw entry) is what's needed to correct the field names/shapes.

import { cached } from "@/lib/cache";

const ITEMS_URL_KO =
  "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/ko_kr/v1/items.json";
const ITEMS_URL_DEFAULT =
  "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/items.json";
const ASSET_BASE = "https://raw.communitydragon.org/latest/game/";

const CACHE_TTL_MS = 60 * 60 * 1000;

// Riot's own map id for Summoner's Rift — same numbering Data Dragon's
// item.json `maps` block used (see this file's header comment).
const SUMMONERS_RIFT_MAP_ID = "11";

export interface CommunityDragonItem {
  id: number;
  name: string;
  iconUrl: string;
  tags: string[];
  cost: { base: number; total: number; sell: number };
  /** Normalized onto the same Flat*Mod/Percent*Mod key style Data Dragon's
   * item.json stats used to use — see src/lib/itemStats.ts. Percent-type
   * stats are stored as fractions (0.25 = 25%), same assumption Data
   * Dragon's own stats block used, unverified against a live Community
   * Dragon response. */
  stats: Record<string, number>;
  plainDescription: string;
  /** Whether this item is actually purchasable in the shop right now. */
  inStore: boolean;
  /** True when this item doesn't build into anything else (`to` empty) —
   * i.e. it's a finished/final-tier item, not a component/recipe step. */
  isFinalTier: boolean;
  /** True when `requiredChampion`/`requiredAlly` is set — a variant most
   * builds can't actually buy (e.g. Kalista's Black Spear, Ornn upgrades). */
  isRestrictedVariant: boolean;
  /** `maps["11"]` (Summoner's Rift) — true unless the feed explicitly marks
   * this item unavailable there (ARAM/Arena-only items, etc.). Defaults to
   * true when the `maps` block itself is missing for an item, rather than
   * excluding it — a missing field isn't evidence the item is unavailable,
   * same "don't penalize a data gap" principle this file already applies to
   * `stats`. */
  availableOnSummonersRift: boolean;
}

interface RawCDStatBlock {
  flat?: number;
  percent?: number;
}

interface RawCommunityDragonItem {
  id: number;
  name?: string;
  iconPath?: string;
  categories?: string[];
  price?: number;
  priceTotal?: number;
  simpleDescription?: string;
  inStore?: boolean;
  to?: number[];
  requiredChampion?: string;
  requiredAlly?: string;
  stats?: Record<string, RawCDStatBlock>;
  maps?: Record<string, boolean>;
}

/** Maps a Community Dragon stat concept key to the Flat*Mod/Percent*Mod
 * output key(s) it becomes — reusing Data Dragon's old key names where the
 * concept overlaps (so src/lib/itemStats.ts's existing labels keep working
 * unchanged) and inventing new ones, following the same naming convention,
 * for concepts Data Dragon never had at all. */
const CD_STAT_KEY_MAP: Record<string, { flatKey?: string; percentKey?: string }> = {
  abilityPower: { flatKey: "FlatMagicDamageMod" },
  attackDamage: { flatKey: "FlatPhysicalDamageMod", percentKey: "PercentPhysicalDamageMod" },
  armor: { flatKey: "FlatArmorMod" },
  armorPenetration: { flatKey: "FlatArmorPenetrationMod", percentKey: "PercentArmorPenetrationMod" },
  attackSpeed: { percentKey: "PercentAttackSpeedMod" },
  cooldownReduction: { percentKey: "PercentCooldownReductionMod" },
  abilityHaste: { flatKey: "FlatAbilityHasteMod" },
  criticalStrikeChance: { percentKey: "FlatCritChanceMod" },
  healAndShieldPower: { percentKey: "PercentHealShieldPowerMod" },
  health: { flatKey: "FlatHPPoolMod" },
  healthRegen: { flatKey: "FlatHPRegenMod", percentKey: "PercentHPRegenMod" },
  lethality: { flatKey: "FlatLethalityMod" },
  lifesteal: { percentKey: "PercentLifeStealMod" },
  magicPenetration: { flatKey: "FlatMagicPenetrationMod", percentKey: "PercentMagicPenetrationMod" },
  magicResistance: { flatKey: "FlatSpellBlockMod" },
  mana: { flatKey: "FlatMPPoolMod" },
  manaRegen: { flatKey: "FlatMPRegenMod", percentKey: "PercentMPRegenMod" },
  movespeed: { flatKey: "FlatMovementSpeedMod", percentKey: "PercentMovementSpeedMod" },
  omnivamp: { percentKey: "PercentOmnivampMod" },
  physicalVamp: { percentKey: "PercentPhysicalVampMod" },
  spellVamp: { percentKey: "PercentSpellVampMod" },
  tenacity: { percentKey: "PercentTenacityMod" },
};

function normalizeStats(raw: Record<string, RawCDStatBlock> | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw) return out;
  for (const [concept, block] of Object.entries(raw)) {
    const mapping = CD_STAT_KEY_MAP[concept];
    if (!mapping || !block) continue;
    if (mapping.flatKey && block.flat) out[mapping.flatKey] = block.flat;
    if (mapping.percentKey && block.percent) out[mapping.percentKey] = block.percent;
  }
  return out;
}

/** "/lol-game-data/assets/ASSETS/Items/Icons2D/x.png" (mixed case, as
 * stored in the raw item data) -> a fetchable, lowercased URL under
 * Community Dragon's asset CDN. */
function toAssetUrl(iconPath: string): string {
  const stripped = iconPath.replace(/^\/?lol-game-data\/assets\//i, "");
  return ASSET_BASE + stripped.toLowerCase();
}

async function fetchItems(url: string): Promise<Map<number, CommunityDragonItem>> {
  const res = await fetch(url, {
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
  const map = new Map<number, CommunityDragonItem>();
  for (const raw of body as RawCommunityDragonItem[]) {
    if (typeof raw?.id !== "number") continue;
    const total = raw.priceTotal ?? 0;
    map.set(raw.id, {
      id: raw.id,
      name: raw.name ?? "",
      iconUrl: raw.iconPath ? toAssetUrl(raw.iconPath) : "",
      tags: raw.categories ?? [],
      cost: { base: raw.price ?? total, total, sell: Math.round(total * 0.7) },
      stats: normalizeStats(raw.stats),
      plainDescription: raw.simpleDescription ?? "",
      inStore: raw.inStore ?? false,
      isFinalTier: (raw.to?.length ?? 0) === 0,
      isRestrictedVariant: Boolean(raw.requiredChampion) || Boolean(raw.requiredAlly),
      availableOnSummonersRift: raw.maps?.[SUMMONERS_RIFT_MAP_ID] !== false,
    });
  }
  return map;
}

async function fetchItemsWithLocaleFallback(): Promise<Map<number, CommunityDragonItem>> {
  try {
    return await fetchItems(ITEMS_URL_KO);
  } catch {
    return fetchItems(ITEMS_URL_DEFAULT);
  }
}

/** Throws on total failure (both the ko_kr and default locale requests
 * failing, or an unexpected response shape) — this feed is now the item-
 * build tab's ONLY data source (no Data Dragon fallback), so callers
 * should surface that failure rather than silently rendering an empty
 * catalog. Cached for an hour either way, same as this app's other
 * external sources. */
export async function getCommunityDragonItems(): Promise<Map<number, CommunityDragonItem>> {
  return cached("communitydragon:items", CACHE_TTL_MS, fetchItemsWithLocaleFallback);
}
