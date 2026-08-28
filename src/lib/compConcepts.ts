// Team-comp "concept" detection (돌진/포킹/쌍포 등) and a static matchup
// reference between concepts.
//
// This is explicitly NOT measured data — no site publishes real win rates
// for "poke comp vs dive comp" (the sample doesn't exist in a clean form),
// so unlike everything else in this app it can't be grounded in a scraped
// number. It's two things layered together, both kept honest about what
// they are:
//
//  1. Per-champion "does this champion fit concept X" checks, built from
//     REAL Data Dragon signals only (tags, info.attack/defense/magic, and
//     the keyword/range-derived ability tags from championSkills.ts) — see
//     each detector's comment for exactly which signals and why. Still a
//     heuristic (same caveats as championSkills.ts), but grounded.
//  2. A small, static concept-vs-concept reference table — this part is
//     pure strategic knowledge (the well-known "poke beats protect, protect
//     beats engage, engage beats poke" triangle, plus a couple of looser
//     notes for the other two concepts), not derived from any per-request
//     data at all. It's a fixed lookup table, included for context next to
//     the detected concepts — never presented as a percentage or a rate.

import type { DDragonChampion } from "@/lib/ddragon";
import type { ChampionAbilities } from "@/lib/championSkills";

export type CompConceptId = "engage" | "poke" | "protect" | "teamfight" | "splitPush";

export interface CompConceptInfo {
  id: CompConceptId;
  label: string;
  description: string;
}

export const COMP_CONCEPTS: CompConceptInfo[] = [
  { id: "engage", label: "돌진/이니시", description: "갭클로저나 하드 CC로 먼저 거리를 좁혀 싸움을 겁니다." },
  { id: "poke", label: "포킹", description: "사거리 긴 스킬로 소모전을 걸어 정면 교전을 피합니다." },
  { id: "protect", label: "쌍포/보호", description: "스쿼시한 캐리를 CC·보호막으로 지키며 딜을 극대화합니다." },
  { id: "teamfight", label: "한타", description: "하드 CC와 탱커로 진형을 잡고 5:5 교전을 유도합니다." },
  { id: "splitPush", label: "스플릿 푸시", description: "1:1에 강한 챔피언으로 사이드 라인을 지속적으로 압박합니다." },
];

const CONCEPT_BY_ID = new Map(COMP_CONCEPTS.map((c) => [c.id, c]));

function fitsEngage(c: DDragonChampion, a: ChampionAbilities | undefined): boolean {
  const hasCloser = a?.hasMobility === true || a?.hasHardCC === true;
  const diveRole = c.tags.includes("Assassin") || c.tags.includes("Fighter") || c.tags.includes("Tank");
  return hasCloser && diveRole;
}

function fitsPoke(c: DDragonChampion, a: ChampionAbilities | undefined): boolean {
  const rangedPoker = a?.hasLongRange === true && a?.hasMobility !== true;
  const damageRole = c.tags.includes("Mage") || c.tags.includes("Marksman");
  return rangedPoker && damageRole;
}

function fitsProtectCarry(c: DDragonChampion): boolean {
  return (c.tags.includes("Marksman") || c.tags.includes("Mage")) && (c.info?.defense ?? 5) <= 4;
}

function fitsProtectPeel(c: DDragonChampion, a: ChampionAbilities | undefined): boolean {
  return a?.hasShieldOrHeal === true || (c.tags.includes("Support") && a?.hasHardCC === true);
}

function fitsTeamfight(c: DDragonChampion, a: ChampionAbilities | undefined): boolean {
  const groupRole = c.tags.includes("Tank") || c.tags.includes("Support") || c.tags.includes("Mage");
  return a?.hasHardCC === true && groupRole;
}

function fitsSplitPush(c: DDragonChampion): boolean {
  return c.tags.includes("Fighter") && (c.info?.defense ?? 0) >= 5;
}

/** Which of the 5 known comp concepts a SINGLE champion individually fits —
 * reuses the exact same tag/ability-based detectors analyzeCompConcepts
 * already uses for whole-team aggregation, just evaluated for one champion
 * on its own rather than counted across a filled roster. A champion can fit
 * more than one (e.g. a tanky Fighter reads as both "engage" and
 * "teamfight") — returned in COMP_CONCEPTS' declared order; the caller
 * decides how many to actually show. Individually, "protect" only needs
 * EITHER the carry role OR the peeler role (fitsProtectCarry(c) ||
 * fitsProtectPeel(c, a)) — unlike analyzeCompConcepts' team-level
 * `dominant` gate, which requires both roles present somewhere in the whole
 * roster before calling a TEAM protect-focused; for one champion on its
 * own, having either role already is what "fits protect" means.
 *
 * Exposed as a "게임 스타일"/individual win-condition-ish hint on
 * candidate cards (pick recommendation, lane counter) — same "app-curated
 * strategic knowledge, not measured data" caveat as the rest of this file
 * (see the file header comment). */
export function championConceptFit(
  champ: DDragonChampion,
  abilities: ChampionAbilities | undefined,
): CompConceptId[] {
  const fits: CompConceptId[] = [];
  if (fitsEngage(champ, abilities)) fits.push("engage");
  if (fitsPoke(champ, abilities)) fits.push("poke");
  if (fitsProtectCarry(champ) || fitsProtectPeel(champ, abilities)) fits.push("protect");
  if (fitsTeamfight(champ, abilities)) fits.push("teamfight");
  if (fitsSplitPush(champ)) fits.push("splitPush");
  return fits;
}

export interface CompConceptScore {
  id: CompConceptId;
  matchCount: number;
  matchedChampionIds: number[];
}

export interface CompConceptAnalysis {
  filledCount: number;
  /** All 5 concepts, sorted by matchCount desc (ties keep COMP_CONCEPTS order). */
  scores: CompConceptScore[];
  /** The concept with the most matches, only if it clears a "this is
   * actually the comp's identity, not just one champion fitting" bar
   * (matchCount >= 2, and — for "protect" specifically — both a fragile
   * carry AND a peeler present, not just N champions of either kind alone).
   * null on a genuinely mixed comp with no standout concept. */
  dominant: CompConceptId | null;
}

/** Analyzes a filled ally/enemy roster (as many of the 5 slots as are
 * actually picked) into how many champions fit each of the five known comp
 * concepts. `abilitiesByChampionId` is best-effort — a champion missing
 * from it (e.g. its Data Dragon detail fetch failed) is still counted for
 * DDragonChampion-only checks (splitPush) but skipped for ability-dependent
 * ones (engage/poke/teamfight/protect's peel role). */
export function analyzeCompConcepts(
  champs: DDragonChampion[],
  abilitiesByChampionId: Map<number, ChampionAbilities>,
): CompConceptAnalysis | null {
  if (champs.length === 0) return null;

  const withAbilities = champs.map((c) => ({ champ: c, abilities: abilitiesByChampionId.get(c.id) }));

  const engageMatches = withAbilities.filter(({ champ, abilities }) => fitsEngage(champ, abilities));
  const pokeMatches = withAbilities.filter(({ champ, abilities }) => fitsPoke(champ, abilities));
  const protectCarries = champs.filter(fitsProtectCarry);
  const protectPeelers = withAbilities.filter(({ champ, abilities }) => fitsProtectPeel(champ, abilities));
  const teamfightMatches = withAbilities.filter(({ champ, abilities }) => fitsTeamfight(champ, abilities));
  const splitPushMatches = champs.filter(fitsSplitPush);

  const protectMatchedIds = Array.from(
    new Set([...protectCarries.map((c) => c.id), ...protectPeelers.map((p) => p.champ.id)]),
  );

  const unsorted: CompConceptScore[] = [
    { id: "engage", matchCount: engageMatches.length, matchedChampionIds: engageMatches.map((m) => m.champ.id) },
    { id: "poke", matchCount: pokeMatches.length, matchedChampionIds: pokeMatches.map((m) => m.champ.id) },
    { id: "protect", matchCount: protectMatchedIds.length, matchedChampionIds: protectMatchedIds },
    {
      id: "teamfight",
      matchCount: teamfightMatches.length,
      matchedChampionIds: teamfightMatches.map((m) => m.champ.id),
    },
    { id: "splitPush", matchCount: splitPushMatches.length, matchedChampionIds: splitPushMatches.map((c) => c.id) },
  ];
  const scores = unsorted.sort((a, b) => b.matchCount - a.matchCount);

  // Walk the sorted list and take the first entry that actually qualifies,
  // rather than only ever looking at scores[0] — "protect" carries an extra
  // gate (see below) and can fail it while tied with (or even ahead of)
  // another concept that doesn't need that gate, and ties are broken by
  // array-declaration order (Array.prototype.sort is stable), which isn't a
  // sound basis for "this concept doesn't count, give up entirely". A
  // scores[0]-only check silently returned null in exactly that case.
  let dominant: CompConceptId | null = null;
  for (const candidate of scores) {
    if (candidate.matchCount < 2) break; // sorted desc — nothing after this can qualify either
    if (candidate.id === "protect") {
      // "Protect" specifically needs BOTH a squishy carry to protect and
      // something doing the protecting — otherwise it's just "a team with
      // some squishy champions", not a coherent protect-the-carries plan.
      if (protectCarries.length >= 1 && protectPeelers.length >= 1) {
        dominant = "protect";
        break;
      }
      continue;
    }
    dominant = candidate.id;
    break;
  }

  return { filledCount: champs.length, scores, dominant };
}

export function conceptInfo(id: CompConceptId): CompConceptInfo {
  const info = CONCEPT_BY_ID.get(id);
  if (!info) throw new Error(`Unknown comp concept id: ${id}`);
  return info;
}

export interface ConceptMatchup {
  favors: CompConceptId;
  against: CompConceptId;
  reason: string;
}

// The core triangle (poke > protect > engage > poke) is well-established
// LoL strategy shorthand, not something invented for this app. teamfight/
// splitPush get looser one-off notes instead of being forced into the same
// clean cycle — their relationship to the others is much more tempo- and
// execution-dependent in real games, and a false "X always beats Y" here
// would be more misleading than useful.
export const CONCEPT_MATCHUPS: ConceptMatchup[] = [
  { favors: "poke", against: "protect", reason: "뭉쳐서 캐리를 지키는 대형은 정면 교전 전에 포킹으로 계속 깎여나감" },
  { favors: "protect", against: "engage", reason: "탄탄한 CC·보호막으로 이니시를 받아치고 역으로 캐리가 딜을 넣음" },
  { favors: "engage", against: "poke", reason: "갭클로저로 거리를 좁히면 포킹형은 사거리 이점 없이 근접전에 몰림" },
  { favors: "teamfight", against: "splitPush", reason: "5:5를 강제할 수 있으면 스플릿의 사이드 이득이 무의미해짐" },
  { favors: "splitPush", against: "poke", reason: "포킹형은 대개 사이드 1:1이 약해 지속적인 라인 압박에 취약" },
];

/** Looks up whatever's known about `a` vs `b` in CONCEPT_MATCHUPS, in
 * either direction. Returns null if there's no established note for that
 * pair (most cross-pairs involving teamfight/splitPush don't have one —
 * see the comment above CONCEPT_MATCHUPS for why that's deliberate). */
export function lookupConceptMatchup(a: CompConceptId, b: CompConceptId): ConceptMatchup | null {
  return (
    CONCEPT_MATCHUPS.find((m) => (m.favors === a && m.against === b) || (m.favors === b && m.against === a)) ?? null
  );
}
