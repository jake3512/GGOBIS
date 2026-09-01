// Korean labels + percent-vs-flat formatting for Data Dragon item.json's
// `stats` block (see DDragonItem.stats, src/lib/ddragon.ts). Raw Data Dragon
// key names (e.g. "FlatPhysicalDamageMod") are official and stable, but not
// meant for display — this maps the commonly-seen keys to a shop-style
// Korean stat category list, used both for the item-build tab's per-item
// stat readout and its "스탯 종류별로 검색" category filter chips.
//
// KNOWN LIMITATION (see DDragonItem.stats doc comment): Data Dragon's
// `stats` block only covers "legacy" numeric stat mods. Modern stats like
// Ability Haste, Lethality, Omnivamp, and Heal & Shield Power are never in
// this block at all — an item whose whole point is Ability Haste (e.g. many
// enchants) will show no matching category here, even though it clearly has
// a notable stat. That's a Data Dragon limitation, not a bug in this
// mapping — those items just aren't filterable by stat category this way,
// only findable by name search or by reading their plainDescription text.

export interface ItemStatCategory {
  key: string;
  label: string;
  isPercent: boolean;
}

/** Ordered like a real in-game shop's stat filter tabs (offense first, then
 * defense, then utility) — this order also drives the filter chip row. */
export const ITEM_STAT_CATEGORIES: ItemStatCategory[] = [
  { key: "FlatPhysicalDamageMod", label: "공격력", isPercent: false },
  { key: "FlatMagicDamageMod", label: "주문력", isPercent: false },
  { key: "FlatCritChanceMod", label: "치명타 확률", isPercent: true },
  { key: "PercentAttackSpeedMod", label: "공격 속도", isPercent: true },
  { key: "FlatAttackSpeedMod", label: "공격 속도", isPercent: false },
  { key: "FlatHPPoolMod", label: "체력", isPercent: false },
  { key: "FlatMPPoolMod", label: "마나", isPercent: false },
  { key: "FlatArmorMod", label: "방어력", isPercent: false },
  { key: "FlatSpellBlockMod", label: "마법 저항력", isPercent: false },
  { key: "FlatMovementSpeedMod", label: "이동속도", isPercent: false },
  { key: "PercentMovementSpeedMod", label: "이동속도", isPercent: true },
  { key: "FlatHPRegenMod", label: "체력 재생", isPercent: false },
  { key: "FlatMPRegenMod", label: "마나 재생", isPercent: false },
  { key: "PercentLifeStealMod", label: "생명력 흡수", isPercent: true },
];

const CATEGORY_BY_KEY = new Map(ITEM_STAT_CATEGORIES.map((c) => [c.key, c]));

/** Korean label for a raw Data Dragon stat key — falls back to a humanized
 * version of the key itself (strip Flat/Percent/Mod, split camelCase) for
 * any key not in the table above, so an unmapped or future stat still shows
 * *something* readable instead of breaking. */
export function statLabel(key: string): string {
  const known = CATEGORY_BY_KEY.get(key);
  if (known) return known.label;
  return key
    .replace(/^Flat/, "")
    .replace(/^Percent/, "")
    .replace(/Mod$/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim();
}

/** Formats a raw stat value the way item.json stores it — percent stats as
 * a fraction (0.25 = "25%"), flat stats as-is (trimming a trailing .0). */
export function formatStatValue(key: string, value: number): string {
  const known = CATEGORY_BY_KEY.get(key);
  if (known?.isPercent) return `${(value * 100).toFixed(0)}%`;
  return Number.isInteger(value) ? `${value}` : value.toFixed(1);
}
