// "1대1 통계를 만들어줘 데이터는 기존에 있는 모든 데이터를 활용해서 넣어줘"
// — a dedicated head-to-head comparison of exactly two champions at one
// position, composed entirely from data this app already fetches elsewhere
// (no new scraping source). Each side (a/b) gets its own real lane-counter
// win rate, power curve, ability/key-tag detail, and lol.ps+DeepLoL builds —
// the same per-candidate pipeline /api/counters and /api/pickadvice already
// run, just pointed at exactly one named opponent instead of a whole
// candidate list.
//
// The a/b win rate is DELIBERATELY fetched independently in both directions
// (getAggregatedLaneCounters(champA.slug, ...) to find champB's entry, AND
// getAggregatedLaneCounters(champB.slug, ...) to find champA's entry) rather
// than deriving one side as "1 - the other side's rate" — this doubles the
// number of site requests, but keeps both numbers as real, separately
// measured data from each source (matching this app's "no fabricated
// numbers" convention) instead of an assumed complement that ignores draws/
// remakes or each source's own independent sample.

import { NextResponse } from "next/server";
import {
  getChampionsWithFallback,
  getItemsWithCache,
  getLatestVersion,
  getRunesDataWithCache,
  getSummonerSpellsWithCache,
  type DDragonChampion,
} from "@/lib/ddragon";
import { POSITIONS, type Position } from "@/lib/positions";
import { getAggregatedLaneCounters } from "@/lib/sources/aggregate";
import {
  getChampionAbilitiesWithCache,
  toKeyTags,
  toAbilityDetails,
  type ChampionAbilities,
  type KeyTags,
  type AbilityDetail,
} from "@/lib/championSkills";
import { championConceptFit, type CompConceptId } from "@/lib/compConcepts";
import {
  getChampionBuild,
  getPowerCurve,
  getVersusStats,
  laneIdToPosition,
  powerCurveVsFitScore,
  type VersusStats,
  type PowerCurveWithLane,
} from "@/lib/sources/lolps";
import { getChampionBuild as getDeeplolChampionBuild } from "@/lib/sources/deeplol";
import { toBuildResult, type BuildResult, type BuildRefData } from "@/lib/buildRefs";
import { scoreEnemyCompFit, applySkillFitBonus } from "@/lib/teamComp";

const VALID_POSITIONS = new Set(POSITIONS.map((p) => p.value));
const POSITION_LABEL = new Map(POSITIONS.map((p) => [p.value, p.label]));

interface VersusSourceValue {
  sourceId: string;
  sourceLabel: string;
  winRate: number;
  games: number;
}

interface VersusSourceError {
  sourceId: string;
  sourceLabel: string;
  message: string;
}

interface VersusSide {
  championId: number;
  name: string;
  iconUrl: string;
  /** This champion's own real measured win rate against the OTHER side, at
   * `position` — null when every source failed for this direction (see the
   * file-header doc comment on why this is fetched independently per side). */
  winRate: number | null;
  games: number | null;
  bySource: VersusSourceValue[];
  sourcesSucceeded: number;
  sourcesAttempted: number;
  sourceErrors: VersusSourceError[];
  earlyWinRate?: number | null;
  lateWinRate?: number | null;
  powerCurveLaneNote?: string | null;
  powerCurvePoints?: { minute: number; winRate: number }[] | null;
  /** How much THIS champion's own power curve favors them against the other
   * side's curve — see powerCurveVsFitScore, src/lib/sources/lolps.ts. */
  powerCurveVsOpponentFit?: number;
  keyTags?: KeyTags;
  abilityDetails?: AbilityDetail[];
  conceptFits?: CompConceptId[];
  build?: BuildResult | null;
  buildDeeplol?: BuildResult | null;
  /** scoreEnemyCompFit/applySkillFitBonus (teamComp.ts) treating the OTHER
   * side as a 1-champion "enemy comp" — same tag/kit-based fit heuristic
   * pickadvice/counters already use, not a win rate. */
  compFitVsOpponent?: number;
}

function emptySide(champ: DDragonChampion): VersusSide {
  return {
    championId: champ.id,
    name: champ.name,
    iconUrl: champ.iconUrl,
    winRate: null,
    games: null,
    bySource: [],
    sourcesSucceeded: 0,
    sourcesAttempted: 0,
    sourceErrors: [],
  };
}

/** This champion's (`self`) own real win rate against `opponent` — fetches
 * self's full lane-counter list and picks out just opponent's entry, same
 * "winRate is always from the queried champion's own perspective" convention
 * /api/counters uses. */
async function fetchOwnWinRateVsOpponent(
  self: DDragonChampion,
  opponent: DDragonChampion,
  position: Position,
  champions: DDragonChampion[],
): Promise<VersusSide> {
  const side = emptySide(self);
  try {
    const counters = await getAggregatedLaneCounters(self.slug, position, champions);
    side.sourcesSucceeded = counters.sourcesSucceeded;
    side.sourcesAttempted = counters.sourcesAttempted;
    side.sourceErrors = counters.errors;
    const entry = counters.entries.find((e) => e.championId === opponent.id);
    if (entry) {
      side.winRate = entry.primary.winRate;
      side.games = entry.primary.games;
      side.bySource = entry.bySource.map((s) => ({
        sourceId: s.sourceId,
        sourceLabel: s.sourceLabel,
        winRate: s.winRate,
        games: s.games,
      }));
    }
  } catch {
    // All sources failed for this direction — side stays at its empty
    // defaults (sourcesSucceeded 0), same best-effort convention as every
    // other route in this app.
  }
  return side;
}

/** Mutates `side` in place with power-curve early/late win rate + the
 * per-minute point line — same fields /api/counters attaches per candidate,
 * just for exactly one named champion here. Returns the raw curve (or null
 * on failure) so the caller can also compute powerCurveVsOpponentFit once
 * both sides' curves are in hand. */
async function attachPowerCurve(side: VersusSide, championId: number, position: Position): Promise<PowerCurveWithLane | null> {
  try {
    const curve = await getPowerCurve(championId);
    side.earlyWinRate = curve.earlyWinRate;
    side.lateWinRate = curve.lateWinRate;
    side.powerCurvePoints = curve.points;
    side.powerCurveLaneNote =
      curve.actualPosition && curve.actualPosition !== position
        ? `lol.ps는 ${side.name}의 ${POSITION_LABEL.get(curve.actualPosition) ?? curve.actualPosition} 라인 데이터만 갖고 있어요 — 아래 수치는 실제로 그 라인 기준입니다.`
        : null;
    return curve;
  } catch {
    return null;
  }
}

/** Mutates `side` in place with keyTags/abilityDetails/conceptFits — same
 * Meraki-backed fields /api/counters and /api/pickadvice already attach per
 * candidate. Returns the raw ChampionAbilities (or null) so the caller can
 * also run applySkillFitBonus once both sides' abilities are in hand. */
async function attachAbilities(
  side: VersusSide,
  champ: DDragonChampion,
  version: string,
): Promise<ChampionAbilities | null> {
  try {
    const abilities = await getChampionAbilitiesWithCache(champ.slug, version);
    side.keyTags = toKeyTags(abilities);
    side.conceptFits = championConceptFit(champ, abilities);
    return abilities;
  } catch {
    return null;
  }
}

async function attachBuilds(
  side: VersusSide,
  champ: DDragonChampion,
  position: Position,
  refData: BuildRefData,
): Promise<void> {
  const [lolpsResult, deeplolResult] = await Promise.allSettled([
    getChampionBuild(champ.id, position, { allowMismatch: true }),
    getDeeplolChampionBuild(champ.id, position),
  ]);
  if (lolpsResult.status === "fulfilled") {
    const build = lolpsResult.value;
    const actualPosition = laneIdToPosition(build.laneId);
    const laneNote =
      actualPosition && actualPosition !== position
        ? `lol.ps는 ${side.name}의 ${POSITION_LABEL.get(actualPosition) ?? actualPosition} 라인 데이터만 갖고 있어요 — 아래 빌드는 실제로 그 라인 기준입니다.`
        : null;
    side.build = toBuildResult({ id: champ.id, name: champ.name, iconUrl: champ.iconUrl }, position, build, refData, laneNote);
  }
  if (deeplolResult.status === "fulfilled") {
    side.buildDeeplol = toBuildResult(
      { id: champ.id, name: champ.name, iconUrl: champ.iconUrl },
      position,
      deeplolResult.value,
      refData,
    );
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const championAId = Number(searchParams.get("championA"));
  const championBId = Number(searchParams.get("championB"));
  const position = searchParams.get("position") as Position | null;

  if (!Number.isInteger(championAId) || !Number.isInteger(championBId)) {
    return NextResponse.json({ error: "championA, championB query params are required" }, { status: 400 });
  }
  if (championAId === championBId) {
    return NextResponse.json({ error: "championA and championB must be different champions" }, { status: 400 });
  }
  if (!position || !VALID_POSITIONS.has(position)) {
    return NextResponse.json(
      { error: `position must be one of: ${[...VALID_POSITIONS].join(", ")}` },
      { status: 400 },
    );
  }

  const champions = await getChampionsWithFallback();
  const champA = champions.find((c) => c.id === championAId);
  const champB = champions.find((c) => c.id === championBId);
  if (!champA || !champB) {
    return NextResponse.json({ error: "Unknown championA/championB" }, { status: 400 });
  }

  const [a, b] = await Promise.all([
    fetchOwnWinRateVsOpponent(champA, champB, position, champions),
    fetchOwnWinRateVsOpponent(champB, champA, position, champions),
  ]);

  const version = await getLatestVersion();
  const [curveA, curveB, abilitiesA, abilitiesB, refData, versusStatsResult] = await Promise.all([
    attachPowerCurve(a, champA.id, position),
    attachPowerCurve(b, champB.id, position),
    attachAbilities(a, champA, version),
    attachAbilities(b, champB, version),
    Promise.all([getItemsWithCache(), getSummonerSpellsWithCache(), getRunesDataWithCache()])
      .then(([items, spells, runesData]): BuildRefData => ({ items, spells, runes: runesData.runes, trees: runesData.trees }))
      .catch(() => null),
    getVersusStats(champA.id, champB.id, position).catch(() => null),
  ]);

  if (curveA && curveB) {
    a.powerCurveVsOpponentFit = powerCurveVsFitScore(curveA, curveB) ?? undefined;
    b.powerCurveVsOpponentFit = powerCurveVsFitScore(curveB, curveA) ?? undefined;
  }

  if (abilitiesA) {
    a.abilityDetails = toAbilityDetails(abilitiesA, undefined);
    let fit = scoreEnemyCompFit(champA, [champB]);
    if (abilitiesB) fit = applySkillFitBonus(fit, abilitiesA, [abilitiesB]);
    a.compFitVsOpponent = fit;
  }
  if (abilitiesB) {
    b.abilityDetails = toAbilityDetails(abilitiesB, undefined);
    let fit = scoreEnemyCompFit(champB, [champA]);
    if (abilitiesA) fit = applySkillFitBonus(fit, abilitiesB, [abilitiesA]);
    b.compFitVsOpponent = fit;
  }

  if (refData) {
    await Promise.all([
      attachBuilds(a, champA, position, refData),
      attachBuilds(b, champB, position, refData),
    ]);
  }

  const versusStats: VersusStats | null = versusStatsResult;

  return NextResponse.json({
    position,
    a,
    b,
    versusStats,
  });
}
