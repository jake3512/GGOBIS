// All six sources this app pulls from, live, on every request — see each
// entry's comment for how confident we are that its URL pattern / slug
// convention is actually correct. This dev sandbox has no outbound access to
// any of these sites, so most configs below are still best-effort guesses;
// op.gg, lol.ps, and deeplol (see src/lib/sources/deeplol.ts) have been
// confirmed against real response bodies the user captured from their own
// browser. Confidence levels for the rest just reflect how well-established
// each site's general structure is in the codebase author's background
// knowledge, not actual testing. Once you run this for real, please report
// which sources work and which don't — the fix is almost always just
// correcting one config below.

import { createGenericSource, type GenericSourceConfig } from "@/lib/sources/genericSource";
import { deeplolSource } from "@/lib/sources/deeplol";
import { lolpsSource } from "@/lib/sources/lolps";
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
    // query param, that guess was wrong twice over). Only .../synergies/adc
    // was actually confirmed against a real response — duoUrl below now
    // takes the champion's own position instead of hardcoding "adc" so
    // pick-advice can check synergy for allies in any role, but whether
    // op.gg's synergies page works the same way for top/jungle/mid/support
    // as it does for adc is UNCONFIRMED, carried over from the general
    // pattern the rest of this URL scheme follows.
    //
    // The query string (region/type/tier/patch) turned out to matter too —
    // confirmed via the user finding the exact network request (by content-
    // searching for a win-rate number visible on the page) whose response
    // actually contained the matchup data: .../counters/top?region=global&
    // type=ranked&tier=emerald_plus&patch=16.16. Without it the page 200s
    // but apparently doesn't render the stat table. `patch` is a moving
    // target (this site patches LoL roughly every 2 weeks), so it's
    // deliberately left off here on the bet that omitting it falls back to
    // "current patch" rather than erroring — unconfirmed either way.
    id: "opgg",
    label: "op.gg",
    confidence: "high",
    slug: (s) => (s === "MonkeyKing" ? "wukong" : s.toLowerCase()),
    counterUrl: (slug, position) =>
      `https://op.gg/lol/champions/${slug}/counters/${position}?region=global&type=ranked&tier=emerald_plus`,
    duoUrl: (slug, position) =>
      `https://op.gg/lol/champions/${slug}/synergies/${position}?region=global&type=ranked&tier=emerald_plus`,
  },
  {
    // Confidence: medium. u.gg is a well-known second major stats site with
    // a very similar site structure to op.gg.
    id: "ugg",
    label: "u.gg",
    confidence: "medium",
    slug: (s) => (s === "MonkeyKing" ? "wukong" : s.toLowerCase()),
    counterUrl: (slug, position) => `https://u.gg/lol/champions/${slug}/counter?role=${position}`,
    duoUrl: (slug, position) => `https://u.gg/lol/champions/${slug}/synergies?role=${position}`,
  },
  {
    // Confidence: medium. lolalytics is well-known for granular per-lane
    // matchup data; "lane" (not "position"/"role") is its usual term for this.
    id: "lolalytics",
    label: "lolalytics",
    confidence: "medium",
    slug: (s) => (s === "MonkeyKing" ? "wukong" : s.toLowerCase()),
    counterUrl: (slug, position) => `https://lolalytics.com/lol/${slug}/counters/?lane=${position}`,
    duoUrl: (slug, position) => `https://lolalytics.com/lol/${slug}/synergy/?lane=${position}`,
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
    duoUrl: (slug, position) => `https://mobalytics.gg/lol/champions/${slug}/synergies?role=${position}`,
  },
];

// deeplol.gg and lol.ps don't fit the generic "embedded JSON blob in an
// HTML page" model — deeplol serves a clean JSON REST API directly
// (see src/lib/sources/deeplol.ts), and lol.ps embeds data in a SvelteKit
// hydration script with a different shape (see src/lib/sources/lolps.ts) —
// so both are implemented directly and appended here instead of going
// through createGenericSource.
export const SOURCES: StatSource[] = [...configs.map(createGenericSource), deeplolSource, lolpsSource];
