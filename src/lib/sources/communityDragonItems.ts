// Community Dragon's own extracted game-data feed — "데이터베이스를 이걸로
// 교체해줘": the user uploaded a real, verified dump of
// https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/items.json
// (868 items, saved as src/data/communityDragonItems.json). This is now
// bundled and read directly — NO live network fetch happens for item data
// at all anymore. That fixes two things at once:
//   1. This sandbox's outbound network to raw.communitydragon.org was
//      always blocked (confirmed via WebFetch and curl all session), so
//      the live-fetch version could never be exercised or verified here.
//   2. The real schema turned out to differ from what the earlier
//      (never-verified) version of this file assumed — see "WHAT CHANGED"
//      below. Every field mapping below is now grounded in the actual
//      uploaded data, not a guess at Community Dragon's public schema.
//
// This remains the ONLY data source for the "아이템 빌드" tab (/api/items)
// — "아이템 빌드에서는 datadragon의 데이터를 쓰지 말아줘 모든 데이터를
// 제시한 링크에서만 가져와줘". Data Dragon's item.json (src/lib/ddragon.ts)
// is still used elsewhere in the app (champion "빌드" tab, pick-advice build
// cards) but never in this tab's code path.
//
// WHAT CHANGED once real data was available (previous assumptions in
// parentheses were all wrong):
//   - There is NO `stats` object anywhere in the real data (previously
//     assumed `{concept: {flat, percent}}` blocks) — every one of the 868
//     items lacks it. Numeric stats only exist as human-readable text
//     inside `description`'s `<stats>...</stats>` block (e.g.
//     "<attention> 75</attention> Attack Damage"). This file now parses
//     that text instead (see parseStatsFromDescription/STAT_LABEL_KEY_MAP).
//   - There is NO `simpleDescription` field (previously assumed to exist).
//     `plainDescription` is now derived by stripping the `<stats>` block and
//     all remaining markup out of `description` (see stripDescriptionTags).
//   - There is NO `maps` field (previously assumed, added for "협곡에서 쓸
//     수 있는 아이템만" — `availableOnSummonersRift` has been removed
//     entirely since nothing in the real data can answer that question).
//     What real data DOES show: many items appear multiple times under
//     different ids for the SAME name — e.g. "Infinity Edge" as 3031 (normal
//     price/stats), 223031 (ARAM rebalance), 773031 (Arena rebalance).
//     There's no per-item mode flag, but the LOWEST id among same-named
//     duplicates is consistently the normal Summoner's Rift version in
//     every case checked — /api/items now dedupes on exactly that (keep the
//     minimum id per name) instead of "keep whichever the array happened to
//     list first". A small number of clearly-non-buildable entries (game-
//     mode placeholders, URF/Arena champion-power items, 0-cost vouchers)
//     all share one trait confirmed against the real data: an EMPTY
//     `categories` array — every genuine buildable item has at least one
//     category, so /api/items also requires `categories.length > 0`. Some
//     special-mode items without a normal-SR name collision may still slip
//     through this heuristic (there's no ground-truth mode field to check
//     against) — if one shows up, the fix is a one-line name-based
//     exclusion, not a redesign of this filter.
//   - `price`/`priceTotal`/`inStore`/`to`/`requiredChampion`/`requiredAlly`/
//     `categories`/`iconPath`/`name` all matched what this file already
//     assumed — those mappings are unchanged.
//
// Fields used from the real schema, and what each maps onto below:
//   - `inStore` — whether the item is actually orderable in the shop.
//   - `to` (number[]) — items this upgrades into; non-empty means it's a
//     component/recipe item, not a finished one (`isFinalTier`).
//   - `requiredChampion`/`requiredAlly` — champion/ally-locked variants.
//   - `name` — display name. NOTE: this dump is Community Dragon's
//     "global/default" (English) locale — the user's uploaded file has
//     English names ("Infinity Edge", not "무한의 검"). This app's UI is
//     otherwise all Korean; if a Korean-locale dump becomes available it can
//     replace this same file without any code changes (same shape).
//   - `iconPath` — converted to a fetchable Community Dragon asset CDN URL
//     (`toAssetUrl`): "/lol-game-data/assets/" prefix stripped, remainder
//     lowercased.
//   - `categories` (string[]) — same concept as Data Dragon's `tags`.
//   - `price` / `priceTotal` — combine-only cost / full total cost. No sell
//     price field exists, so `cost.sell` is DERIVED (not sourced) as 70% of
//     `priceTotal`, rounded — League's standard sell-back ratio.
//   - `description` — rich HTML-ish markup (Riot's tooltip format). Mined
//     for both the numeric stats list and the plain-text passive summary
//     (see below) — nothing here is rendered as raw HTML.

import rawItemsData from "@/data/communityDragonItems.json";

const ASSET_BASE = "https://raw.communitydragon.org/latest/game/";

export interface CommunityDragonItem {
  id: number;
  name: string;
  iconUrl: string;
  tags: string[];
  cost: { base: number; total: number; sell: number };
  /** Parsed out of `description`'s `<stats>...</stats>` text (see
   * parseStatsFromDescription) — NOT a structured field in the source data.
   * Onto the same Flat*Mod/Percent*Mod key style Data Dragon's item.json
   * `stats` used to use, so src/lib/itemStats.ts's existing label/filter
   * table keeps working. Percent-type stats are stored as fractions (0.25 =
   * 25%). A label this file doesn't recognize (STAT_LABEL_KEY_MAP miss) is
   * silently dropped rather than guessed at. */
  stats: Record<string, number>;
  /** Derived by stripping `description`'s `<stats>` block and all remaining
   * markup tags — see stripDescriptionTags. Covers passive/active effect
   * text (e.g. Rabadon's "Magical Opus" passive); empty for pure-stat items
   * (e.g. boots, Infinity Edge) that have nothing beyond their stats block. */
  plainDescription: string;
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
  name?: string;
  description?: string;
  iconPath?: string;
  categories?: string[];
  price?: number;
  priceTotal?: number;
  inStore?: boolean;
  to?: number[];
  requiredChampion?: string;
  requiredAlly?: string;
}

/** English stat-label text (as it appears after `<attention>`/`<ornnBonus>`
 * in `description`'s `<stats>` block) -> the Flat*Mod/Percent*Mod key(s) it
 * becomes. Built by scanning every label that actually occurs across all 868
 * items in the bundled dump (see the module header) rather than guessed —
 * `mode: "flat"`/`"percent"` is used when every observed occurrence of that
 * label was consistently one or the other; `"auto"` is used for the few
 * labels (Move Speed, Magic Penetration) that occur as BOTH a flat number
 * and a percentage depending on the item, detected per-occurrence by
 * whether the value string has a trailing "%". Reuses Data Dragon's old key
 * names where the concept overlaps (so src/lib/itemStats.ts's existing
 * labels keep working unchanged) and adds new ones, following the same
 * naming convention, for concepts Data Dragon's item.json never had at all
 * (Gold Per 10, Adaptive Force, Critical Strike Damage — see itemStats.ts). */
const STAT_LABEL_KEY_MAP: Record<
  string,
  { mode: "flat" | "percent" | "auto"; flatKey?: string; percentKey?: string }
> = {
  Health: { mode: "flat", flatKey: "FlatHPPoolMod" },
  "Ability Haste": { mode: "flat", flatKey: "FlatAbilityHasteMod" },
  "Attack Damage": { mode: "flat", flatKey: "FlatPhysicalDamageMod" },
  "Ability Power": { mode: "flat", flatKey: "FlatMagicDamageMod" },
  Armor: { mode: "flat", flatKey: "FlatArmorMod" },
  "Move Speed": { mode: "auto", flatKey: "FlatMovementSpeedMod", percentKey: "PercentMovementSpeedMod" },
  "Magic Resist": { mode: "flat", flatKey: "FlatSpellBlockMod" },
  "Attack Speed": { mode: "percent", percentKey: "PercentAttackSpeedMod" },
  Mana: { mode: "flat", flatKey: "FlatMPPoolMod" },
  "Critical Strike Chance": { mode: "percent", percentKey: "FlatCritChanceMod" },
  "Base Mana Regen": { mode: "percent", percentKey: "PercentMPRegenMod" },
  Lethality: { mode: "flat", flatKey: "FlatLethalityMod" },
  "Heal and Shield Power": { mode: "percent", percentKey: "PercentHealShieldPowerMod" },
  "Base Health Regen": { mode: "percent", percentKey: "PercentHPRegenMod" },
  "Life Steal": { mode: "percent", percentKey: "PercentLifeStealMod" },
  "Mana Regen per 5 seconds": { mode: "flat", flatKey: "FlatMPRegenMod" },
  "Magic Penetration": { mode: "auto", flatKey: "FlatMagicPenetrationMod", percentKey: "PercentMagicPenetrationMod" },
  "Cooldown Reduction": { mode: "percent", percentKey: "PercentCooldownReductionMod" },
  "Gold Per 10 Seconds": { mode: "flat", flatKey: "FlatGoldPer10Mod" },
  Omnivamp: { mode: "percent", percentKey: "PercentOmnivampMod" },
  "Health Regen per 5 seconds": { mode: "flat", flatKey: "FlatHPRegenMod" },
  Tenacity: { mode: "percent", percentKey: "PercentTenacityMod" },
  "Adaptive Force": { mode: "flat", flatKey: "FlatAdaptiveForceMod" },
  "Armor Penetration": { mode: "percent", percentKey: "PercentArmorPenetrationMod" },
  "Critical Strike Damage": { mode: "percent", percentKey: "PercentCritDamageMod" },
};

/** Pulls the `<attention>VALUE</attention> Label` (and Ornn-upgrade
 * `<ornnBonus>VALUE</ornnBonus> Label`) pairs out of `description`'s
 * `<stats>...</stats>` block and maps each recognized label onto
 * STAT_LABEL_KEY_MAP. Values are summed when the same output key appears
 * more than once on one item (e.g. an Ornn-upgraded item's base Armor plus
 * its `<ornnBonus>` Armor) rather than the later one silently overwriting
 * the earlier. An unrecognized label, or a value that doesn't parse as a
 * number, is dropped for just that one line — never guessed at. */
function parseStatsFromDescription(description: string): Record<string, number> {
  const out: Record<string, number> = {};
  const statsMatch = description.match(/<stats>([\s\S]*?)<\/stats>/);
  if (!statsMatch) return out;
  const lines = statsMatch[1].split(/<br\s*\/?>|<li>/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = line.match(/<(?:attention|ornnBonus)>([^<]*)<\/(?:attention|ornnBonus)>\s*(.*)/);
    if (!m) continue;
    const [, rawValue, rawLabel] = m;
    const label = rawLabel.replace(/<[^>]+>/g, "").trim();
    const mapping = STAT_LABEL_KEY_MAP[label];
    if (!mapping) continue;
    const isPercent = rawValue.includes("%");
    const numeric = parseFloat(rawValue.replace("%", "").trim());
    if (Number.isNaN(numeric)) continue;

    let key: string | undefined;
    let value: number;
    if (mapping.mode === "flat" || (mapping.mode === "auto" && !isPercent)) {
      key = mapping.flatKey;
      value = numeric;
    } else {
      key = mapping.percentKey;
      value = numeric / 100;
    }
    if (!key) continue;
    out[key] = (out[key] ?? 0) + value;
  }
  return out;
}

/** Derives a readable plain-text summary from `description`: drops the
 * `<stats>...</stats>` block entirely (those numbers are already surfaced
 * structurally via `stats` above, no need to duplicate them as text), then
 * strips every remaining markup tag and collapses `<br>`/whitespace into
 * single spaces. Mirrors what Data Dragon's own `plaintext` field used to
 * provide server-side — this file does the same stripping itself since the
 * real Community Dragon schema doesn't ship a pre-stripped version. */
function stripDescriptionTags(description: string): string {
  const withoutStats = description.replace(/<stats>[\s\S]*?<\/stats>/, "");
  return withoutStats
    .replace(/<br\s*\/?>/g, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** "/lol-game-data/assets/ASSETS/Items/Icons2D/x.png" (mixed case, as
 * stored in the raw item data) -> a fetchable, lowercased URL under
 * Community Dragon's asset CDN. */
function toAssetUrl(iconPath: string): string {
  const stripped = iconPath.replace(/^\/?lol-game-data\/assets\//i, "");
  return ASSET_BASE + stripped.toLowerCase();
}

function toCommunityDragonItem(raw: RawCommunityDragonItem): CommunityDragonItem | null {
  if (typeof raw.id !== "number") return null;
  const total = raw.priceTotal ?? 0;
  const description = raw.description ?? "";
  return {
    id: raw.id,
    name: raw.name ?? "",
    iconUrl: raw.iconPath ? toAssetUrl(raw.iconPath) : "",
    tags: raw.categories ?? [],
    cost: { base: raw.price ?? total, total, sell: Math.round(total * 0.7) },
    stats: parseStatsFromDescription(description),
    plainDescription: stripDescriptionTags(description),
    inStore: raw.inStore ?? false,
    isFinalTier: (raw.to?.length ?? 0) === 0,
    isRestrictedVariant: Boolean(raw.requiredChampion) || Boolean(raw.requiredAlly),
  };
}

let itemsCache: Map<number, CommunityDragonItem> | null = null;

/** Reads the bundled static dump (src/data/communityDragonItems.json) —
 * no network call, so this can't fail the way a live fetch could. Kept
 * async so call sites (which pre-date this bundling and awaited a network
 * response) didn't need to change. Computed once per server process and
 * cached in memory since the underlying file never changes at runtime. */
export async function getCommunityDragonItems(): Promise<Map<number, CommunityDragonItem>> {
  if (itemsCache) return itemsCache;
  const map = new Map<number, CommunityDragonItem>();
  for (const raw of rawItemsData as RawCommunityDragonItem[]) {
    const item = toCommunityDragonItem(raw);
    if (item) map.set(item.id, item);
  }
  itemsCache = map;
  return map;
}
