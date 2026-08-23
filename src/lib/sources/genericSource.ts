import { cached } from "@/lib/cache";
import type { Position } from "@/lib/positions";
import { extractBestStatList, extractEmbeddedJsonRoots, fetchHtml } from "@/lib/scrape";
import type { StatSource, SourceCounterResult, SourceDuoResult } from "@/lib/sources/types";

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export interface GenericSourceConfig {
  id: string;
  label: string;
  confidence: "high" | "medium" | "low";
  /** Data Dragon slug -> this site's champion slug. Defaults to lowercasing. */
  slug?(dataDragonSlug: string): string;
  counterUrl(slug: string, position: Position): string;
  duoUrl(adcSlug: string): string;
}

/** Builds a StatSource for any site that server-renders its pages with an
 * embedded JSON state blob (Next.js/Nuxt-style) — which covers most modern
 * stat sites. See src/lib/scrape.ts for how the data is actually located
 * inside that blob once fetched. */
export function createGenericSource(config: GenericSourceConfig): StatSource {
  const toSlug = config.slug ?? ((s: string) => s.toLowerCase());

  return {
    id: config.id,
    label: config.label,
    confidence: config.confidence,

    async getLaneCounters(dataDragonSlug, position): Promise<SourceCounterResult> {
      const slug = toSlug(dataDragonSlug);
      return cached(`${config.id}:counters:${slug}:${position}`, CACHE_TTL_MS, async () => {
        const url = config.counterUrl(slug, position);
        const html = await fetchHtml(url);
        const roots = extractEmbeddedJsonRoots(html, config.label);
        const counters = extractBestStatList(roots);
        if (counters.length === 0) {
          throw new Error(
            `${config.label}: fetched the page but couldn't locate matchup data in it.`,
          );
        }
        return { sourceId: config.id, sourceLabel: config.label, sourceUrl: url, counters };
      });
    },

    async getBotDuoSynergy(adcSlugRaw, supportSlugRaw, supportChampionId): Promise<SourceDuoResult> {
      const adcSlug = toSlug(adcSlugRaw);
      const supportSlug = toSlug(supportSlugRaw);
      return cached(`${config.id}:duo:${adcSlug}:${supportSlug}`, CACHE_TTL_MS, async () => {
        const url = config.duoUrl(adcSlug);
        const html = await fetchHtml(url);
        const roots = extractEmbeddedJsonRoots(html, config.label);
        const entries = extractBestStatList(roots);
        const match = entries.find((e) => e.championId === supportChampionId);
        return {
          sourceId: config.id,
          sourceLabel: config.label,
          sourceUrl: url,
          winRate: match?.winRate ?? null,
          games: match?.games ?? null,
        };
      });
    },
  };
}
