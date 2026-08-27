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
import type { ChampionAbilities } from "@/lib/championSkills";
import { getAdcArchetype, type AdcAttribute } from "@/lib/adcArchetype";

export interface DamageBalance {
  physicalPct: number;
  magicPct: number;
  /** How many of the analyzed champions actually had `info` data available
   * (all of them when Data Dragon is live; possibly fewer when running off
   * the offline fallback snapshot, which doesn't carry `info`). */
  sampledCount: number;
}

export interface AdcArchetypeEntry {
  championId: number;
  attributes: AdcAttribute[];
  flexibleBuild: boolean;
}

export interface TeamCompAnalysis {
  filledCount: number;
  /** e.g. {Fighter: 2, Tank: 1, Mage: 1, Marksman: 1} */
  tagCounts: Record<string, number>;
  /** null if none of the analyzed champions had `info` data. */
  damageBalance: DamageBalance | null;
  hasFrontline: boolean;
  /** Marksman-tagged champions among `champs` that have a curated entry in
   * adcArchetype.ts — see that file for what this is and its "hand-curated,
   * not measured" caveat. Marksman champs missing from the table are simply
   * left out here (not padded with an empty entry). */
  adcArchetypes: AdcArchetypeEntry[];
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

  const adcArchetypes: AdcArchetypeEntry[] = champs
    .filter((c) => c.tags.includes("Marksman"))
    .flatMap((c) => {
      const archetype = getAdcArchetype(c.slug);
      return archetype ? [{ championId: c.id, attributes: archetype.attributes, flexibleBuild: archetype.flexibleBuild }] : [];
    });

  return {
    filledCount: champs.length,
    tagCounts,
    damageBalance,
    hasFrontline: champs.some((c) => c.tags.includes("Tank")),
    adcArchetypes,
  };
}

/** How well a not-yet-picked candidate's own tags/stats complement what's
 * already filled in on the enemy side — same "official static data only,
 * no invented win rate" principle as analyzeTeamComp above, just pointed at
 * a single candidate instead of summarizing an existing comp. Deliberately
 * limited to two well-understood, defensible signals from Data Dragon's
 * coarse per-champion `tags`/`info` (see applySkillFitBonus below for a
 * finer-grained extension using actual per-ability text):
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

/** Refines a compFit score (from scoreEnemyCompFit, or 0.5 to start fresh)
 * using each side's ACTUAL passive/Q/W/E/R kit instead of just the coarse
 * champion tag — see src/lib/championSkills.ts for where hasHardCC/
 * hasMobility/hasShieldOrHeal come from and the caveat that they're a
 * keyword-matched heuristic over Riot's own ability text, not an official
 * taxonomy. Because fetching every champion's full kit is a per-champion
 * network request, callers only do this for a bounded top-N shortlist (see
 * SKILL_FIT_CANDIDATE_LIMIT in the pick-advice route) — everyone else keeps
 * whatever scoreEnemyCompFit already gave them.
 *
 * Two signals, mirroring the tag-based ones in spirit but grounded in real
 * kit content:
 *  - enemy side has no hard CC of its own (nothing can lock the candidate
 *    down) → mobility on the candidate is safer to commit, so it's rewarded.
 *  - enemy side has no escape tools (no mobility, no shield/heal) → hard CC
 *    on the candidate reliably catches them, so it's rewarded.
 *
 * Same clamp-at-1 behavior as scoreEnemyCompFit — this only ever adds on
 * top of the base score, never subtracts, and the result stays in 0..1. */
export function applySkillFitBonus(
  baseScore: number,
  candidateAbilities: ChampionAbilities,
  enemyAbilitiesList: ChampionAbilities[],
): number {
  if (enemyAbilitiesList.length === 0) return baseScore;
  let score = baseScore;

  const enemyHasHardCC = enemyAbilitiesList.some((a) => a.hasHardCC);
  if (!enemyHasHardCC && candidateAbilities.hasMobility) {
    score += 0.2;
  }

  const enemyHasEscapeTools = enemyAbilitiesList.some((a) => a.hasMobility || a.hasShieldOrHeal);
  if (!enemyHasEscapeTools && candidateAbilities.hasHardCC) {
    score += 0.2;
  }

  return Math.min(1, Math.max(0, score));
}
