// "채점식 2" — champion attribute/tag-based team composition heuristic.
// Deliberately NOT win-rate based (no site publishes real win rates for
// arbitrary partial 5-champion comps — the sample sizes don't exist), so
// this only uses Riot's own officially published, static champion metadata
// (Data Dragon's `tags` and `info.attack/defense/magic` ratings) to surface
// a few well-understood, qualitative comp signals: role mix, whether
// there's a frontline/tank, and physical-vs-magic damage balance (a common,
// concrete reason a comp is easy or hard to itemize against). This is a
// simple aggregate computed from official static data, not a measured
// win-rate — see src/lib/sources/aggregate.ts for the real scraped-data
// side of "team synergy".

import type { DDragonChampion } from "@/lib/ddragon";

export interface DamageBalance {
  physicalPct: number;
  magicPct: number;
  /** How many of the analyzed champions actually had `info` data available
   * (all of them when Data Dragon is live; possibly fewer when running off
   * the offline fallback snapshot, which doesn't carry `info`). */
  sampledCount: number;
}

export interface TeamCompAnalysis {
  filledCount: number;
  /** e.g. {Fighter: 2, Tank: 1, Mage: 1, Marksman: 1} */
  tagCounts: Record<string, number>;
  /** null if none of the analyzed champions had `info` data. */
  damageBalance: DamageBalance | null;
  hasFrontline: boolean;
}

export function analyzeTeamComp(champs: DDragonChampion[]): TeamCompAnalysis | null {
  if (champs.length === 0) return null;

  const tagCounts: Record<string, number> = {};
  for (const c of champs) {
    for (const tag of c.tags) tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
  }

  const withInfo = champs.filter((c) => c.info);
  let damageBalance: DamageBalance | null = null;
  if (withInfo.length > 0) {
    const totalAttack = withInfo.reduce((sum, c) => sum + (c.info?.attack ?? 0), 0);
    const totalMagic = withInfo.reduce((sum, c) => sum + (c.info?.magic ?? 0), 0);
    const total = totalAttack + totalMagic;
    if (total > 0) {
      damageBalance = {
        physicalPct: Math.round((totalAttack / total) * 100),
        magicPct: Math.round((totalMagic / total) * 100),
        sampledCount: withInfo.length,
      };
    }
  }

  return {
    filledCount: champs.length,
    tagCounts,
    damageBalance,
    hasFrontline: champs.some((c) => c.tags.includes("Tank")),
  };
}

/** How well a not-yet-picked candidate's own tags/stats complement what's
 * already filled in on the enemy side — same "official static data only,
 * no invented win rate" principle as analyzeTeamComp above, just pointed at
 * a single candidate instead of summarizing an existing comp. Deliberately
 * limited to two well-understood, defensible signals (no CC/mobility/init
 * scoring — Data Dragon doesn't publish that, same restraint as above):
 *
 *  - enemy side has no frontline (no Tank tag among the champions filled
 *    in so far) → burst/assassin candidates get a bonus, since a comp with
 *    no tank dies faster to burst.
 *  - enemy side is majority Fighter/Assassin (dive-heavy) → tanky or
 *    high-`info.defense` candidates get a bonus, since that's a safer pick
 *    into repeated all-ins.
 *
 * Returns 0..1 where 0.5 is neutral (nothing filled in yet on the enemy
 * side, or neither signal applies to this candidate) — see the caller for
 * how small a weight this carries next to real scraped win rates. */
export function scoreEnemyCompFit(candidate: DDragonChampion, enemyChamps: DDragonChampion[]): number {
  if (enemyChamps.length === 0) return 0.5;
  let score = 0.5;

  const enemyHasFrontline = enemyChamps.some((c) => c.tags.includes("Tank"));
  if (!enemyHasFrontline && candidate.tags.includes("Assassin")) {
    score += 0.25;
  }

  const diveTaggedCount = enemyChamps.filter(
    (c) => c.tags.includes("Fighter") || c.tags.includes("Assassin"),
  ).length;
  const enemyIsDiveHeavy = diveTaggedCount / enemyChamps.length >= 0.5;
  if (enemyIsDiveHeavy) {
    const candidateIsTanky = candidate.tags.includes("Tank") || (candidate.info?.defense ?? 0) >= 6;
    if (candidateIsTanky) score += 0.25;
  }

  return Math.min(1, Math.max(0, score));
}
