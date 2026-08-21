import type { Position } from "@/lib/positions";

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
  confidence: "medium" | "low";
  getLaneCounters(dataDragonSlug: string, position: Position): Promise<SourceCounterResult>;
  getBotDuoSynergy(
    adcDataDragonSlug: string,
    supportDataDragonSlug: string,
    supportChampionId: number,
  ): Promise<SourceDuoResult>;
}
