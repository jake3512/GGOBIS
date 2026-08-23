import { SOURCES } from "@/lib/sources/registry";
import type { Position } from "@/lib/positions";
import type { ChampionRef, SourceCounterResult } from "@/lib/sources/types";

export interface SourceValue {
  sourceId: string;
  sourceLabel: string;
  sourceUrl: string;
  winRate: number;
  games: number;
}

export interface AggregatedCounterEntry {
  championId: number;
  /** Up to 3 sources with the largest sample size for this specific matchup. */
  bySource: SourceValue[];
  /** The single most-sampled source's number — what the UI leads with. */
  primary: SourceValue;
}

export interface SourceError {
  sourceId: string;
  sourceLabel: string;
  message: string;
}

export interface AggregatedCounters {
  entries: AggregatedCounterEntry[];
  errors: SourceError[];
  sourcesSucceeded: number;
  sourcesAttempted: number;
}

/** Shared merge logic for anything shaped like "one source call per site,
 * each returning a ranked {championId, winRate, games}[] list" — used by
 * both lane counters and duo-candidate lookups. */
async function aggregateCounterLike(
  promises: Promise<SourceCounterResult>[],
): Promise<AggregatedCounters> {
  const settled = await Promise.allSettled(promises);

  const errors: SourceError[] = [];
  const byChampion = new Map<number, SourceValue[]>();

  settled.forEach((result, i) => {
    const source = SOURCES[i];
    if (result.status === "rejected") {
      errors.push({
        sourceId: source.id,
        sourceLabel: source.label,
        message: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
      return;
    }
    for (const c of result.value.counters) {
      const list = byChampion.get(c.championId) ?? [];
      list.push({
        sourceId: source.id,
        sourceLabel: source.label,
        sourceUrl: result.value.sourceUrl,
        winRate: c.winRate,
        games: c.games,
      });
      byChampion.set(c.championId, list);
    }
  });

  const sourcesSucceeded = settled.filter((r) => r.status === "fulfilled").length;
  if (sourcesSucceeded === 0) {
    throw new Error(
      `All ${SOURCES.length} sources failed. ` +
        errors.map((e) => `${e.sourceLabel}: ${e.message}`).join(" | "),
    );
  }

  const entries: AggregatedCounterEntry[] = [...byChampion.entries()].map(
    ([championId, sources]) => {
      const bySource = [...sources].sort((a, b) => b.games - a.games).slice(0, 3);
      return { championId, bySource, primary: bySource[0] };
    },
  );

  return { entries, errors, sourcesSucceeded, sourcesAttempted: SOURCES.length };
}

export async function getAggregatedLaneCounters(
  dataDragonSlug: string,
  position: Position,
  champions: ChampionRef[],
): Promise<AggregatedCounters> {
  return aggregateCounterLike(
    SOURCES.map((s) => s.getLaneCounters(dataDragonSlug, position, champions)),
  );
}

/** All of a known ADC's synergy partners, ranked — used to recommend picks
 * (mainly supports) that pair well with an already-locked ADC. */
export async function getAggregatedDuoCandidates(
  adcSlug: string,
  champions: ChampionRef[],
): Promise<AggregatedCounters> {
  return aggregateCounterLike(SOURCES.map((s) => s.getBotDuoCandidates(adcSlug, champions)));
}

export interface AggregatedDuo {
  bySource: SourceValue[];
  errors: SourceError[];
  sourcesSucceeded: number;
  sourcesAttempted: number;
}

export async function getAggregatedDuoSynergy(
  adcSlug: string,
  supportSlug: string,
  supportChampionId: number,
  champions: ChampionRef[],
): Promise<AggregatedDuo> {
  const settled = await Promise.allSettled(
    SOURCES.map((s) => s.getBotDuoSynergy(adcSlug, supportSlug, supportChampionId, champions)),
  );

  const errors: SourceError[] = [];
  const values: SourceValue[] = [];

  settled.forEach((result, i) => {
    const source = SOURCES[i];
    if (result.status === "rejected") {
      errors.push({
        sourceId: source.id,
        sourceLabel: source.label,
        message: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
      return;
    }
    if (result.value.winRate !== null && result.value.games !== null) {
      values.push({
        sourceId: source.id,
        sourceLabel: source.label,
        sourceUrl: result.value.sourceUrl,
        winRate: result.value.winRate,
        games: result.value.games,
      });
    }
  });

  const sourcesSucceeded = settled.filter((r) => r.status === "fulfilled").length;
  if (sourcesSucceeded === 0) {
    throw new Error(
      `All ${SOURCES.length} sources failed. ` +
        errors.map((e) => `${e.sourceLabel}: ${e.message}`).join(" | "),
    );
  }

  const bySource = values.sort((a, b) => b.games - a.games).slice(0, 3);
  return { bySource, errors, sourcesSucceeded, sourcesAttempted: SOURCES.length };
}
