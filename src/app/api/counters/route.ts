import { NextResponse } from "next/server";
import { getChampionsWithFallback, getLatestVersion, type DDragonChampion } from "@/lib/ddragon";
import { POSITIONS, type Position } from "@/lib/positions";
import { getAggregatedLaneCounters } from "@/lib/sources/aggregate";
import { getChampionAbilitiesWithCache, toKeyTags, type KeyTags } from "@/lib/championSkills";
import { championConceptFit, type CompConceptId } from "@/lib/compConcepts";
import { getPowerCurve, getVersusStats, powerCurveVsFitScore, type VersusStats } from "@/lib/sources/lolps";
import { sampleReliabilityTier } from "@/lib/sampleSize";

const VALID_POSITIONS = new Set(POSITIONS.map((p) => p.value));
const POSITION_LABEL = new Map(POSITIONS.map((p) => [p.value, p.label]));

// Same reasoning/value as pickadvice's SKILL_FIT_CANDIDATE_LIMIT — only the
// best few counters (the ones actually looked at) get a per-champion Data
// Dragon detail fetch for "핵심 태그"/"게임 스타일".
const KEY_TAGS_CANDIDATE_LIMIT = 5;

// Same reasoning as above, but for lol.ps's separate versus/stats.json
// head-to-head endpoint (라인전 세부지표/팁) — kept as its own named limit
// even though it's currently the same value, matching this app's convention
// of one constant per feature (see pickadvice's *_CANDIDATE_LIMIT block).
const LANING_STATS_CANDIDATE_LIMIT = 5;

// Same reasoning again, for lol.ps's graphs.json power curve — pickadvice
// already used this for its own recommendation lists (POWER_CURVE_CANDIDATE_LIMIT,
// src/app/api/pickadvice/route.ts); this route never had it wired in at all
// until now.
const POWER_CURVE_CANDIDATE_LIMIT = 5;

interface CounterEntry {
  championId: number;
  name: string;
  iconUrl: string;
  winRate: number;
  games: number;
  bySource: { sourceId: string; sourceLabel: string; winRate: number; games: number }[];
  keyTags?: KeyTags;
  conceptFits?: CompConceptId[];
  /** lol.ps head-to-head laning-phase stats (this champion vs the counter) —
   * only on the top few entries (see LANING_STATS_CANDIDATE_LIMIT). The
   * client derives "라인전 팁" text from this (see buildLaningTips,
   * src/app/page.tsx) rather than the server computing tip text, matching
   * how PowerCurveBadge/ccDotState already turn raw numbers into labels
   * client-side elsewhere in this app. */
  laningStats?: VersusStats | null;
  /** lol.ps power-curve early/late win rate for THIS counter — same fields
   * pickadvice's PickEntry already carries, only on the top few entries (see
   * POWER_CURVE_CANDIDATE_LIMIT). lol.ps only ever tracks a champion's own
   * primary lane, so shown even off-position with `powerCurveLaneNote`
   * flagging the mismatch (same convention as pickadvice). */
  earlyWinRate?: number | null;
  lateWinRate?: number | null;
  powerCurveLaneNote?: string | null;
  /** Full per-minute win-rate line behind earlyWinRate/lateWinRate above —
   * same top-N-only limit, see PowerCurveWithLane.points. */
  powerCurvePoints?: { minute: number; winRate: number }[] | null;
  /** How much the user's OWN looked-up champion's power curve favors them
   * against THIS counter's — 0.5 neutral, up to 1.0 (see powerCurveVsFitScore,
   * src/lib/sources/lolps.ts). A high value means: even though this
   * champion is a real statistical counter, your side's early/late-game
   * window may still work in your favor. Only on the top few entries. */
  powerCurveVsMineFit?: number;
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

/** Best-effort attaches lol.ps's head-to-head laning-phase stats (this
 * champion vs each of the top N counters) — same endpoint/fields pickadvice
 * already uses for counterPicks (`getVersusStats`, `src/lib/sources/lolps.ts`),
 * just never wired into this route before. `champion` (the route's own
 * `championId` param) is always sent as the "ally" side, so `laningStats.ally`
 * consistently means the champion the user is looking up, same convention
 * pickadvice uses. Independent per-entry failures (lol.ps down, or no games
 * for this exact matchup+lane) just leave that entry's laningStats unset. */
async function attachLaningStats(
  entries: CounterEntry[],
  championId: number,
  position: Position,
): Promise<void> {
  const top = entries.slice(0, LANING_STATS_CANDIDATE_LIMIT);
  if (top.length === 0) return;
  const results = await Promise.allSettled(
    top.map((e) => getVersusStats(championId, e.championId, position)),
  );
  top.forEach((entry, i) => {
    const r = results[i];
    if (r.status === "fulfilled") entry.laningStats = r.value;
  });
}

/** Best-effort attaches lol.ps's power curve to the top N counters — same
 * endpoint/fields pickadvice's refineTopWithPowerCurveAndLaning already uses
 * for its own recommendation lists, just never wired into this route before.
 * Fetches the user's OWN looked-up champion's curve once (not per-entry),
 * then compares each counter's curve against it (powerCurveVsFitScore) so
 * `powerCurveVsMineFit` consistently means "favors my side" from the
 * perspective of the champion being looked up. Independent per-entry
 * failures just leave that entry's power-curve fields unset. */
async function attachPowerCurve(
  entries: CounterEntry[],
  championId: number,
  position: Position,
): Promise<void> {
  const top = entries.slice(0, POWER_CURVE_CANDIDATE_LIMIT);
  if (top.length === 0) return;
  const myCurve = await getPowerCurve(championId).catch(() => null);
  const results = await Promise.allSettled(top.map((e) => getPowerCurve(e.championId)));
  top.forEach((entry, i) => {
    const r = results[i];
    if (r.status !== "fulfilled") return;
    const curve = r.value;
    entry.earlyWinRate = curve.earlyWinRate;
    entry.lateWinRate = curve.lateWinRate;
    entry.powerCurvePoints = curve.points;
    entry.powerCurveLaneNote =
      curve.actualPosition && curve.actualPosition !== position
        ? `lol.ps는 ${entry.name}의 ${POSITION_LABEL.get(curve.actualPosition) ?? curve.actualPosition} 라인 데이터만 갖고 있어요 — 아래 수치는 실제로 그 라인 기준입니다.`
        : null;
    if (myCurve) {
      entry.powerCurveVsMineFit = powerCurveVsFitScore(myCurve, curve) ?? undefined;
    }
  });
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
      // 표본(게임 수) 신뢰도 구간을 최우선으로, 구간 안에서만 승률로 정렬
      // (worst-for-us = best counters first) — sampleReliabilityTier 참고.
      .sort((a, b) => {
        const tierDiff = sampleReliabilityTier(a.games) - sampleReliabilityTier(b.games);
        return tierDiff !== 0 ? tierDiff : a.winRate - b.winRate;
      });
    // Independent sources writing disjoint fields — run concurrently instead
    // of paying the sum of both round trips (same convention as pickadvice's
    // annotateWithBuild/annotateWithDeeplolBuild Promise.all).
    await Promise.all([
      attachKeyTagsAndConceptFits(counters, champById),
      attachLaningStats(counters, championId, position),
      attachPowerCurve(counters, championId, position),
    ]);
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
