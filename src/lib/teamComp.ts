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
import type { AbilityTag, ChampionAbilities } from "@/lib/championSkills";
import { getAdcArchetype, type AdcAttribute } from "@/lib/adcArchetype";
import { getTankArchetype, type TankAttribute } from "@/lib/tankArchetype";
import { getBruiserArchetype, type BruiserAttribute } from "@/lib/bruiserArchetype";

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

export interface TankArchetypeEntry {
  championId: number;
  attributes: TankAttribute[];
}

export interface BruiserArchetypeEntry {
  championId: number;
  attributes: BruiserAttribute[];
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
  /** Same idea as `adcArchetypes`, for Tank-tagged champions (which already
   * covers tank supports too — Riot tags e.g. Leona/Braum/Nautilus with both
   * Support and Tank) — see tankArchetype.ts. */
  tankArchetypes: TankArchetypeEntry[];
  /** Same idea again, for Fighter-tagged champions that are actually curated
   * in bruiserArchetype.ts — unlike the two above, the Fighter tag itself
   * covers many non-"bruiser" champions (junglers, supports, mage hybrids),
   * so most Fighter-tagged champs are simply absent from that table on
   * purpose, not because of a data gap. See that file. */
  bruiserArchetypes: BruiserArchetypeEntry[];
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

  const tankArchetypes: TankArchetypeEntry[] = champs
    .filter((c) => c.tags.includes("Tank"))
    .flatMap((c) => {
      const archetype = getTankArchetype(c.slug);
      return archetype ? [{ championId: c.id, attributes: archetype.attributes }] : [];
    });

  const bruiserArchetypes: BruiserArchetypeEntry[] = champs
    .filter((c) => c.tags.includes("Fighter"))
    .flatMap((c) => {
      const archetype = getBruiserArchetype(c.slug);
      return archetype ? [{ championId: c.id, attributes: archetype.attributes }] : [];
    });

  return {
    filledCount: champs.length,
    tagCounts,
    damageBalance,
    hasFrontline: champs.some((c) => c.tags.includes("Tank")),
    adcArchetypes,
    tankArchetypes,
    bruiserArchetypes,
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

// How much a hasMobility/hasHardCC bonus below gets scaled by how often the
// candidate's OWN matching ability is actually back up — "모든 픽추천
// 로직을 발전시켜줘": these two bonuses used to be a flat +0.2 regardless of
// whether the tool was a 4초 dash or an 80초 one-shot commit, even though
// this file already fetches each candidate's real per-ability cooldown data
// (AbilitySummary.cooldown) for the tag booleans themselves — that number
// was just never used past the boolean. A rank-1 cooldown at or below
// RELIABLE_COOLDOWN_SECONDS keeps the full bonus (available basically every
// engage); one at or above LONG_COOLDOWN_SECONDS is scaled down to
// MIN_RELIABILITY_FACTOR (a real tool, but a rare one-time commitment, not a
// repeatable safety net); in between it's a straight linear interpolation.
// No larger dataset exists here to calibrate an exact curve against (same
// caveat as this app's other cooldown-based thresholds, e.g.
// POKE_COOLDOWN_THRESHOLD in src/app/page.tsx), so this is deliberately
// simple rather than empirically derived.
const RELIABLE_COOLDOWN_SECONDS = 6;
const LONG_COOLDOWN_SECONDS = 20;
const MIN_RELIABILITY_FACTOR = 0.5;

/** Among the candidate's own Q/W/E (passive excluded — rarely has a real
 * cooldown; ultimate excluded — always long-cooldown by design, so it would
 * always read as "unreliable" here even on a champion whose ultimate IS the
 * relevant hard-CC/mobility tool, same nonUltimateSpells convention
 * championSkills.ts's hasLongRange already uses), finds whichever one(s)
 * carry `tag` and returns a 0..1 reliability factor from the SHORTEST rank-1
 * cooldown among them. Returns 1 (full bonus, unchanged from before this
 * existed) when no matching ability has parseable cooldown data — a missing
 * number is not evidence the tool is unreliable, just that Meraki's response
 * didn't parse cleanly (see extractNumericProgression's own caveat), so this
 * never penalizes for a data gap. */
function abilityReliabilityFactor(abilities: ChampionAbilities, tag: AbilityTag): number {
  const cooldowns = abilities.spells
    .slice(0, 3)
    .filter((a) => a.tags.includes(tag))
    .map((a) => a.cooldown?.[0])
    .filter((c): c is number => c !== undefined);
  if (cooldowns.length === 0) return 1;

  const shortest = Math.min(...cooldowns);
  if (shortest <= RELIABLE_COOLDOWN_SECONDS) return 1;
  if (shortest >= LONG_COOLDOWN_SECONDS) return MIN_RELIABILITY_FACTOR;
  const t = (shortest - RELIABLE_COOLDOWN_SECONDS) / (LONG_COOLDOWN_SECONDS - RELIABLE_COOLDOWN_SECONDS);
  return 1 - t * (1 - MIN_RELIABILITY_FACTOR);
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
 * Each bonus is scaled by abilityReliabilityFactor above — a mobility/hard-CC
 * tool up every few seconds earns the full bonus; the same tool on a long
 * cooldown earns a reduced one, since it's a one-time commitment rather than
 * something the candidate can lean on repeatably.
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
    score += 0.2 * abilityReliabilityFactor(candidateAbilities, "mobility");
  }

  const enemyHasEscapeTools = enemyAbilitiesList.some((a) => a.hasMobility || a.hasShieldOrHeal);
  if (!enemyHasEscapeTools && candidateAbilities.hasHardCC) {
    score += 0.2 * abilityReliabilityFactor(candidateAbilities, "hardCC");
  }

  return Math.min(1, Math.max(0, score));
}
