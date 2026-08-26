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
    dataDragonSlug: string,
    position: Position,
    partnerDataDragonSlug: string,
    partnerChampionId: number,
    champions: ChampionRef[],
  ): Promise<SourceDuoResult>;
  /** All of a known champion's synergy partners, ranked — the same
   * underlying page/data as getBotDuoSynergy, just not filtered down to one
   * specific partner. `position` is that champion's OWN position (not the
   * partner's) — sites whose synergy page is scoped per-position (e.g.
   * op.gg's `/synergies/{position}`) need it to build the right URL.
   * Originally ADC-only ("which support goes well with this ADC"); now used
   * for any position so pick-advice can check synergy with every already-
   * picked ally, not just a locked-in ADC. */
  getBotDuoCandidates(
    dataDragonSlug: string,
    position: Position,
    champions: ChampionRef[],
  ): Promise<SourceCounterResult>;
}
