// Community Dragon's own extracted game-data feed, pulled by the user
// directly:
//   https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/items.json
// — a community-maintained mirror of Riot's client data files. Unlike
// Riot's official Data Dragon `item.json` (see src/lib/ddragon.ts, still
// the fallback source and still where iconUrl/tags/plainDescription always
// come from), this feed carries fields Data Dragon doesn't expose at all,
// which is exactly what this app needed after Data Dragon's own flags
// (`hideFromAll`/`purchasable`) kept mismatching the real current shop when
// tested against the deployed app ("중복된 아이템도 있고 대부분의 아이템이
// 빠져있고 삭제된 아이템도 많이 있어"), and now also supplies name/price/
// stats directly per a follow-up request ("이름 가격 스탯도 제시한
// 링크에서 따와줘"):
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
//   - `name` (string) — display name.
//   - `priceTotal` (number) — the shop price (same concept as Data Dragon's
//     `gold.total`).
//   - `stats` (object, keyed by camelCase stat concept e.g.
//     "abilityPower"/"attackSpeed"/"lethality"/"omnivamp", each a
//     `{flat?, percent?}`-shaped block) — critically, this covers several
//     stats Data Dragon's own `stats` block never included at all (Ability
//     Haste, Lethality, Omnivamp, Physical/Spell Vamp, Tenacity, Heal &
//     Shield Power, Armor/Magic Penetration) — see the KNOWN LIMITATION
//     note that used to live on DDragonItem.stats before this. Normalized
//     below onto the SAME `Flat*Mod`/`Percent*Mod` key style Data Dragon
//     already used (src/lib/itemStats.ts's ITEM_STAT_CATEGORIES has been
//     extended with the new keys) so both sources produce a stats object
//     the rest of the app can treat identically.
//
// LOCALE: the URL the user gave points at "global/default" — Community
// Dragon's convention for the un-localized (English) copy of the data; the
// same path with "default" swapped for a locale code (e.g. "ko_kr") serves
// a translated copy with identical non-text fields (inStore/to/price/
// stats are locale-independent, only name/description change). Since this
// app's entire UI is Korean, this file tries the "ko_kr" path FIRST — same
// underlying Community Dragon data the user pointed at, just the localized
// variant of it — and only falls back to the exact "global/default" URL
// given (English names) if that request itself fails, so the feature still
// works even if the locale-path guess above turns out wrong.
//
// IMPORTANT — none of this could be verified against a live response: this
// session's sandbox has outbound network access blocked for
// raw.communitydragon.org (confirmed via both WebFetch and a direct curl,
// same "organization policy" block that already applied to
// ddragon.leagueoflegends.com and namu.wiki). The shape below is built from
// this endpoint's long-standing, widely-referenced public schema, not a
// fetch this session actually made. It's wired in as a best-effort,
// additive signal for exactly that reason: getCommunityDragonItems() never
// throws, and every call site falls back to the pre-existing Data Dragon
// name/price/stats and Data-Dragon-flags/namu.wiki-allowlist inclusion
// logic for any item this feed doesn't have (or if the fetch fails
// outright) — so a schema mismatch here degrades gracefully instead of
// breaking the whole tab. If the real deploy shows items still
// misclassified, wrong-priced, or missing a stat, the actual response JSON
// (or even just one item's raw entry) is what's needed to correct the
// field names/shapes.

import { cached } from "@/lib/cache";

const ITEMS_URL_KO =
  "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/ko_kr/v1/items.json";
const ITEMS_URL_DEFAULT =
  "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/items.json";

const CACHE_TTL_MS = 60 * 60 * 1000;

export interface CommunityDragonItem {
  id: number;
  name: string;
  /** Total shop price (raw.gold.total's Data Dragon equivalent). */
  priceTotal: number;
  /** Whether this item is actually purchasable in the shop right now. */
  inStore: boolean;
  /** True when this item doesn't build into anything else (`to` empty) —
   * i.e. it's a finished/final-tier item, not a component/recipe step. */
  isFinalTier: boolean;
  /** True when `requiredChampion`/`requiredAlly` is set — a variant most
   * builds can't actually buy (e.g. Kalista's Black Spear, Ornn upgrades). */
  isRestrictedVariant: boolean;
  /** Normalized onto the same Flat*Mod/Percent*Mod key style Data Dragon's
   * item.json stats use — see src/lib/itemStats.ts. Percent-type stats are
   * stored as fractions (0.25 = 25%), same assumption Data Dragon's own
   * stats block uses, unverified against a live Community Dragon response. */
  stats: Record<string, number>;
}

interface RawCDStatBlock {
  flat?: number;
  percent?: number;
}

interface RawCommunityDragonItem {
  id: number;
  name?: string;
  priceTotal?: number;
  inStore?: boolean;
  to?: number[];
  requiredChampion?: string;
  requiredAlly?: string;
  stats?: Record<string, RawCDStatBlock>;
}

/** Maps a Community Dragon stat concept key to the Flat*Mod/Percent*Mod
 * output key(s) it becomes — reusing Data Dragon's existing key names where
 * the concept overlaps (so src/lib/itemStats.ts's existing labels keep
 * working unchanged) and inventing new ones, following the same naming
 * convention, for concepts Data Dragon never had at all. */
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
    map.set(raw.id, {
      id: raw.id,
      name: raw.name ?? "",
      priceTotal: raw.priceTotal ?? 0,
      inStore: raw.inStore ?? false,
      isFinalTier: (raw.to?.length ?? 0) === 0,
      isRestrictedVariant: Boolean(raw.requiredChampion) || Boolean(raw.requiredAlly),
      stats: normalizeStats(raw.stats),
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

/** Best-effort — never throws. Returns an empty map on any failure (network
 * down, unexpected response shape, both the ko_kr and default locale
 * requests failing, ...) so callers can treat "no data for this id" and
 * "the whole fetch failed" the same way: fall back to whatever
 * Data-Dragon-sourced value they already had for that item, same as this
 * app's other best-effort external calls (e.g. counterBuild in the counter
 * tab). */
export async function getCommunityDragonItems(): Promise<Map<number, CommunityDragonItem>> {
  try {
    return await cached("communitydragon:items", CACHE_TTL_MS, fetchItemsWithLocaleFallback);
  } catch {
    return new Map();
  }
}
