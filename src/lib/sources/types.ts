import type { Position } from "@/lib/positions";

/** The subset of Data Dragon champion info a source needs to resolve a
 * site's own champion slug (e.g. op.gg's nested `champion.key: "garen"`)
 * back to our numeric championId. */
export interface ChampionRef {
  id: number;
  slug: string;
}

export interface SourceCounterEntry {
  championId: number;
  winRate: number;
  games: number;
}

export interface SourceCounterResult {
  sourceId: string;
  sourceLabel: string;
  sourceUrl: string;
  counters: SourceCounterEntry[];
}

export interface SourceDuoResult {
  sourceId: string;
  sourceLabel: string;
  sourceUrl: string;
  winRate: number | null;
  games: number | null;
}

export interface StatSource {
  id: string;
  label: string;
  /** Confidence that this source's URL pattern / data shape is actually
   * correct — this app can't reach any of these sites to verify from its
   * dev sandbox, so this is surfaced in the UI/README rather than hidden. */
  confidence: "high" | "medium" | "low";
  getLaneCounters(
    dataDragonSlug: string,
    position: Position,
    champions: ChampionRef[],
  ): Promise<SourceCounterResult>;
  getBotDuoSynergy(
    adcDataDragonSlug: string,
    supportDataDragonSlug: string,
    supportChampionId: number,
    champions: ChampionRef[],
  ): Promise<SourceDuoResult>;
  /** All of a known ADC's synergy partners (mainly supports), ranked —
   * the same underlying page/data as getBotDuoSynergy, just not filtered
   * down to one specific partner. Used for "which support/pick goes well
   * with this ADC" recommendations. */
  getBotDuoCandidates(
    adcDataDragonSlug: string,
    champions: ChampionRef[],
  ): Promise<SourceCounterResult>;
}
