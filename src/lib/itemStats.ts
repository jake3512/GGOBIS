// Korean labels + percent-vs-flat formatting for item stat keys. Originally
// covered only Data Dragon item.json's `stats` block (DDragonItem.stats,
// src/lib/ddragon.ts), whose keys are the "Flat*Mod"/"Percent*Mod" style
// still used below. Since /api/items now prefers Community Dragon's own
// (richer) `stats` block per item when available — normalized onto this
// same key style by communityDragonItems.ts's CD_STAT_KEY_MAP — this table
// now also covers stats Data Dragon never exposed at all (Ability Haste,
// Lethality, Omnivamp, Physical/Spell Vamp, Tenacity, Heal & Shield Power,
// Armor/Magic Penetration, Cooldown Reduction). Used both for the
// item-build tab's per-item stat readout and its "스탯 종류별로 검색"
// category filter chips.
//
// The new entries' exact key spelling/percent-vs-flat shape mirrors
// src/lib/sources/communityDragonItems.ts's CD_STAT_KEY_MAP and carries the
// same unverified-against-a-live-response caveat that file documents.

export interface ItemStatCategory {
  key: string;
  label: string;
  isPercent: boolean;
}

/** Ordered like a real in-game shop's stat filter tabs (offense first, then
 * defense, then utility) — this order also drives the filter chip row. */
export const ITEM_STAT_CATEGORIES: ItemStatCategory[] = [
  { key: "FlatPhysicalDamageMod", label: "공격력", isPercent: false },
  { key: "PercentPhysicalDamageMod", label: "공격력", isPercent: true },
  { key: "FlatMagicDamageMod", label: "주문력", isPercent: false },
  { key: "FlatCritChanceMod", label: "치명타 확률", isPercent: true },
  { key: "PercentAttackSpeedMod", label: "공격 속도", isPercent: true },
  { key: "FlatAttackSpeedMod", label: "공격 속도", isPercent: false },
  { key: "FlatLethalityMod", label: "관통력", isPercent: false },
  { key: "FlatArmorPenetrationMod", label: "방어구 관통력", isPercent: false },
  { key: "PercentArmorPenetrationMod", label: "방어구 관통력", isPercent: true },
  { key: "FlatMagicPenetrationMod", label: "마법 관통력", isPercent: false },
  { key: "PercentMagicPenetrationMod", label: "마법 관통력", isPercent: true },
  { key: "FlatAbilityHasteMod", label: "스킬 가속", isPercent: false },
  { key: "PercentCooldownReductionMod", label: "스킬 가속(쿨감)", isPercent: true },
  { key: "PercentLifeStealMod", label: "생명력 흡수", isPercent: true },
  { key: "PercentOmnivampMod", label: "전능 흡혈", isPercent: true },
  { key: "PercentPhysicalVampMod", label: "물리 흡혈", isPercent: true },
  { key: "PercentSpellVampMod", label: "주문 흡혈", isPercent: true },
  { key: "PercentHealShieldPowerMod", label: "치유 및 보호막 강화", isPercent: true },
  { key: "FlatHPPoolMod", label: "체력", isPercent: false },
  { key: "FlatMPPoolMod", label: "마나", isPercent: false },
  { key: "FlatArmorMod", label: "방어력", isPercent: false },
  { key: "FlatSpellBlockMod", label: "마법 저항력", isPercent: false },
  { key: "PercentTenacityMod", label: "강인함", isPercent: true },
  { key: "FlatMovementSpeedMod", label: "이동속도", isPercent: false },
  { key: "PercentMovementSpeedMod", label: "이동속도", isPercent: true },
  { key: "FlatHPRegenMod", label: "체력 재생", isPercent: false },
  { key: "PercentHPRegenMod", label: "체력 재생", isPercent: true },
  { key: "FlatMPRegenMod", label: "마나 재생", isPercent: false },
  { key: "PercentMPRegenMod", label: "마나 재생", isPercent: true },
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
