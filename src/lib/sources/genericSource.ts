import { cached } from "@/lib/cache";
import type { Position } from "@/lib/positions";
import type { SlugResolver } from "@/lib/scrape";
import { extractBestStatList, extractEmbeddedJsonRoots, fetchHtml } from "@/lib/scrape";
import type {
  StatSource,
  SourceCounterResult,
  SourceDuoResult,
  ChampionRef,
} from "@/lib/sources/types";

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export interface GenericSourceConfig {
  id: string;
  label: string;
  confidence: "high" | "medium" | "low";
  /** Data Dragon slug -> this site's champion slug. Defaults to lowercasing. */
  slug?(dataDragonSlug: string): string;
  counterUrl(slug: string, position: Position): string;
  /** `position` is the champion's OWN position — sites whose synergy page
   * is scoped per-position (op.gg's `/synergies/{position}`, u.gg/
   * Mobalytics's `?role={position}`, lolalytics's `?lane={position}`) need
   * it to build the right URL for any position, not just ADC. */
  duoUrl(slug: string, position: Position): string;
}

/** Builds a StatSource for any site that server-renders its pages with an
 * embedded JSON state blob (Next.js/Nuxt-style) — which covers most modern
 * stat sites. See src/lib/scrape.ts for how the data is actually located
 * inside that blob once fetched. */
export function createGenericSource(config: GenericSourceConfig): StatSource {
  const toSlug = config.slug ?? ((s: string) => s.toLowerCase());

  /** A source's page data may identify champions by ITS OWN slug (e.g.
   * op.gg's nested `champion.key: "garen"`) rather than a numeric id we
   * already know. Build the reverse lookup using the exact same slug
   * transform this source uses for URL-building, so the two stay in sync. */
  function buildSlugResolver(champions: ChampionRef[]): SlugResolver {
    const bySlug = new Map<string, number>();
    for (const c of champions) {
      bySlug.set(toSlug(c.slug).toLowerCase(), c.id);
    }
    return (siteSlug) => bySlug.get(siteSlug.toLowerCase());
  }

  return {
    id: config.id,
    label: config.label,
    confidence: config.confidence,

    async getLaneCounters(dataDragonSlug, position, champions): Promise<SourceCounterResult> {
      const slug = toSlug(dataDragonSlug);
      return cached(`${config.id}:counters:${slug}:${position}`, CACHE_TTL_MS, async () => {
        const url = config.counterUrl(slug, position);
        const html = await fetchHtml(url);
        const roots = extractEmbeddedJsonRoots(html, config.label);
        const counters = extractBestStatList(roots, buildSlugResolver(champions));
        if (counters.length === 0) {
          throw new Error(
            `${config.label}: fetched the page but couldn't locate matchup data in it.`,
          );
        }
        return { sourceId: config.id, sourceLabel: config.label, sourceUrl: url, counters };
      });
    },

    async getBotDuoSynergy(
      slugRaw,
      position,
      partnerSlugRaw,
      partnerChampionId,
      champions,
    ): Promise<SourceDuoResult> {
      const slug = toSlug(slugRaw);
      const { sourceUrl, counters } = await fetchDuoCandidates(slug, position, champions);
      const match = counters.find((e) => e.championId === partnerChampionId);
      return {
        sourceId: config.id,
        sourceLabel: config.label,
        sourceUrl,
        winRate: match?.winRate ?? null,
        games: match?.games ?? null,
      };
    },

    async getBotDuoCandidates(slugRaw, position, champions): Promise<SourceCounterResult> {
      const slug = toSlug(slugRaw);
      return fetchDuoCandidates(slug, position, champions);
    },
  };

  /** Fetches and parses a champion's synergies page once (for its OWN
   * position) — shared by getBotDuoSynergy (which filters down to one
   * partner) and getBotDuoCandidates (which returns the whole ranked list),
   * so both end up sharing the same cache entry instead of double-fetching. */
  function fetchDuoCandidates(
    slug: string,
    position: Position,
    champions: ChampionRef[],
  ): Promise<SourceCounterResult> {
    return cached(`${config.id}:duo:${slug}:${position}`, CACHE_TTL_MS, async () => {
      const url = config.duoUrl(slug, position);
      const html = await fetchHtml(url);
      const roots = extractEmbeddedJsonRoots(html, config.label);
      const counters = extractBestStatList(roots, buildSlugResolver(champions));
      if (counters.length === 0) {
        throw new Error(
          `${config.label}: fetched the page but couldn't locate synergy data in it.`,
        );
      }
      return { sourceId: config.id, sourceLabel: config.label, sourceUrl: url, counters };
    });
  }
}
