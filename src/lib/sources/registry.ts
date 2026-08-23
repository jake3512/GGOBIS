// All six sources this app pulls from, live, on every request — see each
// entry's comment for how confident we are that its URL pattern / slug
// convention is actually correct. NONE of these have been verified against
// the real sites from this dev environment (its sandbox has no outbound
// access to any of them); confidence levels here just reflect how well-
// established each site's general structure is in the codebase author's
// background knowledge, not actual testing. Once you run this for real,
// please report which sources work and which don't — the fix is almost
// always just correcting one config below.

import { createGenericSource, type GenericSourceConfig } from "@/lib/sources/genericSource";
import type { StatSource } from "@/lib/sources/types";

// Data Dragon's slug is already apostrophe-stripped PascalCase (e.g. "Kaisa",
// "JarvanIV"). Sites that show multi-word champions with hyphens need those
// hyphens re-inserted at the PascalCase word boundaries.
function toKebabSlug(dataDragonSlug: string): string {
  return dataDragonSlug
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}

const configs: GenericSourceConfig[] = [
  {
    // Confidence: high. Full tab nav confirmed against a real op.gg page
    // (https://op.gg/lol/champions/nasus/build/top): Counters and Champion
    // synergies are separate sibling routes, not tabs within /build —
    // /lol/champions/{slug}/counters/{position} and
    // .../synergies/{position}, position as a path segment (no `?position=`
    // query param, that guess was wrong twice over). "Champion synergies"
    // isn't ADC+Support-specific, but requesting it from the ADC's page
    // should surface support pairings among the results.
    id: "opgg",
    label: "op.gg",
    confidence: "high",
    slug: (s) => (s === "MonkeyKing" ? "wukong" : s.toLowerCase()),
    counterUrl: (slug, position) => `https://op.gg/lol/champions/${slug}/counters/${position}`,
    duoUrl: (adcSlug) => `https://op.gg/lol/champions/${adcSlug}/synergies/adc`,
  },
  {
    // Confidence: medium. u.gg is a well-known second major stats site with
    // a very similar site structure to op.gg.
    id: "ugg",
    label: "u.gg",
    confidence: "medium",
    slug: (s) => (s === "MonkeyKing" ? "wukong" : s.toLowerCase()),
    counterUrl: (slug, position) => `https://u.gg/lol/champions/${slug}/counter?role=${position}`,
    duoUrl: (adcSlug) => `https://u.gg/lol/champions/${adcSlug}/synergies?role=adc`,
  },
  {
    // Confidence: medium. lolalytics is well-known for granular per-lane
    // matchup data; "lane" (not "position"/"role") is its usual term for this.
    id: "lolalytics",
    label: "lolalytics",
    confidence: "medium",
    slug: (s) => (s === "MonkeyKing" ? "wukong" : s.toLowerCase()),
    counterUrl: (slug, position) => `https://lolalytics.com/lol/${slug}/counters/?lane=${position}`,
    duoUrl: (adcSlug) => `https://lolalytics.com/lol/${adcSlug}/synergy/?lane=adc`,
  },
  {
    // Confidence: low. Mobalytics is known to lean on kebab-case slugs for
    // multi-word champions, unlike op.gg/u.gg — everything else here is a
    // guess extrapolated from the general "champion stats site" pattern.
    id: "mobalytics",
    label: "Mobalytics",
    confidence: "low",
    slug: toKebabSlug,
    counterUrl: (slug, position) =>
      `https://mobalytics.gg/lol/champions/${slug}/counters?role=${position}`,
    duoUrl: (adcSlug) => `https://mobalytics.gg/lol/champions/${adcSlug}/synergies?role=adc`,
  },
  {
    // Confidence: low. The requested site was "deep.lol" — the LoL stats
    // site this most likely refers to actually lives at deeplol.gg, so
    // that's what this targets. If that's the wrong site, please send the
    // exact URL you mean and this config can be corrected.
    id: "deeplol",
    label: "DeepLoL",
    confidence: "low",
    slug: (s) => s.toLowerCase(),
    counterUrl: (slug, position) => `https://www.deeplol.gg/champions/${slug}/counters?position=${position}`,
    duoUrl: (adcSlug) => `https://www.deeplol.gg/champions/${adcSlug}/duos?position=adc`,
  },
  {
    // Confidence: very low. This isn't a site with a known structure in the
    // codebase author's background knowledge — this config is a placeholder
    // following the same generic pattern as the others, essentially
    // unverified even in concept. Please confirm the exact URL for this one.
    id: "lolps",
    label: "lol.ps",
    confidence: "low",
    slug: (s) => s.toLowerCase(),
    counterUrl: (slug, position) => `https://lol.ps/champions/${slug}/counters?position=${position}`,
    duoUrl: (adcSlug) => `https://lol.ps/champions/${adcSlug}/duos?position=adc`,
  },
];

export const SOURCES: StatSource[] = configs.map(createGenericSource);
