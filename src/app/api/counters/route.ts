import { NextResponse } from "next/server";
import { getChampionsWithFallback, getLatestVersion, type DDragonChampion } from "@/lib/ddragon";
import { POSITIONS, type Position } from "@/lib/positions";
import { getAggregatedLaneCounters } from "@/lib/sources/aggregate";
import { getChampionAbilitiesWithCache, toKeyTags, type KeyTags } from "@/lib/championSkills";
import { championConceptFit, type CompConceptId } from "@/lib/compConcepts";

const VALID_POSITIONS = new Set(POSITIONS.map((p) => p.value));

// Same reasoning/value as pickadvice's SKILL_FIT_CANDIDATE_LIMIT — only the
// best few counters (the ones actually looked at) get a per-champion Data
// Dragon detail fetch for "핵심 태그"/"게임 스타일".
const KEY_TAGS_CANDIDATE_LIMIT = 5;

interface CounterEntry {
  championId: number;
  name: string;
  iconUrl: string;
  winRate: number;
  games: number;
  bySource: { sourceId: string; sourceLabel: string; winRate: number; games: number }[];
  keyTags?: KeyTags;
  conceptFits?: CompConceptId[];
}

/** Best-effort attaches "핵심 태그"/"게임 스타일" to the top N counters (sorted
 * best-counter-first) — same pattern and same caveats as pickadvice's
 * annotateWithKeyTagsAndConceptFits; this route just didn't have any Data
 * Dragon detail-fetch pass before this feature, so it's added fresh here. */
async function attachKeyTagsAndConceptFits(
  entries: CounterEntry[],
  champById: Map<number, DDragonChampion>,
): Promise<void> {
  const top = entries.slice(0, KEY_TAGS_CANDIDATE_LIMIT);
  if (top.length === 0) return;
  try {
    const version = await getLatestVersion();
    const results = await Promise.allSettled(
      top.map((e) => {
        const champ = champById.get(e.championId);
        if (!champ) return Promise.reject(new Error("unknown champion"));
        return getChampionAbilitiesWithCache(champ.slug, version);
      }),
    );
    top.forEach((entry, i) => {
      const r = results[i];
      if (r.status !== "fulfilled") return;
      const champ = champById.get(entry.championId);
      entry.keyTags = toKeyTags(r.value);
      if (champ) entry.conceptFits = championConceptFit(champ, r.value);
    });
  } catch {
    // Data Dragon unreachable — leave keyTags/conceptFits unset.
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const championId = Number(searchParams.get("championId"));
  const position = searchParams.get("position") as Position | null;

  if (!Number.isInteger(championId)) {
    return NextResponse.json({ error: "championId query param is required" }, { status: 400 });
  }
  if (!position || !VALID_POSITIONS.has(position)) {
    return NextResponse.json(
      { error: `position must be one of: ${[...VALID_POSITIONS].join(", ")}` },
      { status: 400 },
    );
  }

  const champions = await getChampionsWithFallback();
  const champion = champions.find((c) => c.id === championId);
  if (!champion) {
    return NextResponse.json({ error: "Unknown championId" }, { status: 400 });
  }
  const champById = new Map(champions.map((c) => [c.id, c]));

  try {
    const result = await getAggregatedLaneCounters(champion.slug, position, champions);
    const counters: CounterEntry[] = result.entries
      .map((entry) => {
        const opponent = champById.get(entry.championId);
        if (!opponent) return null;
        return {
          championId: entry.championId,
          name: opponent.name,
          iconUrl: opponent.iconUrl,
          winRate: entry.primary.winRate,
          games: entry.primary.games,
          bySource: entry.bySource.map((s) => ({
            sourceId: s.sourceId,
            sourceLabel: s.sourceLabel,
            winRate: s.winRate,
            games: s.games,
          })),
        };
      })
      .filter((c): c is CounterEntry => c !== null)
      .sort((a, b) => a.winRate - b.winRate); // worst-for-us (best counters) first
    await attachKeyTagsAndConceptFits(counters, champById);
    return NextResponse.json({
      champion: { id: champion.id, name: champion.name, iconUrl: champion.iconUrl },
      position,
      sourcesSucceeded: result.sourcesSucceeded,
      sourcesAttempted: result.sourcesAttempted,
      sourceErrors: result.errors,
      counters,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch counter data" },
      { status: 502 },
    );
  }
}
