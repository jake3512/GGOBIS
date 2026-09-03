"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChampionPicker, type ChampionSummary } from "@/components/ChampionPicker";
import { ChampionIcon } from "@/components/ChampionIcon";
import { WinRateBar } from "@/components/WinRateBar";
import { SourceBreakdown } from "@/components/SourceBreakdown";
import { BuildCard, BuildCardCompact, type BuildResult } from "@/components/BuildCard";
import { Details } from "@/components/Details";
import { POSITIONS, type Position } from "@/lib/positions";
import { itemSetDiffCount } from "@/lib/buildDiff";
import { ItemPicker, type ItemSummary } from "@/components/ItemPicker";
import { statLabel, formatStatValue } from "@/lib/itemStats";

type Mode = "counter" | "advice" | "build" | "compcompare" | "itembuild";

interface ChampionBrief {
  id: number;
  name: string;
  iconUrl: string;
}

interface SourceValue {
  sourceId: string;
  sourceLabel: string;
  winRate: number;
  games: number;
}

interface SourceErrorInfo {
  sourceId: string;
  sourceLabel: string;
  message: string;
}

/** One point of lol.ps's per-minute win-rate line (see PowerCurveDetails
 * below) — the raw data earlyWinRate/midWinRate/lateWinRate everywhere else
 * in this file are just a 3-bucket average of. */
interface PowerCurvePoint {
  minute: number;
  winRate: number;
}

/** This app's own real-signal "핵심 태그" — the same hasHardCC/hasSoftCC/
 * hasMobility/hasShieldOrHeal/hasLongRange booleans championSkills.ts derives
 * from real ability text (Meraki Analytics, English) via keyword matching.
 * Only attached to the top few entries of each list (see *_CANDIDATE_LIMIT
 * server-side) — a per-champion external detail fetch, not free. */
interface KeyTags {
  hasHardCC: boolean;
  hasSoftCC: boolean;
  hasMobility: boolean;
  hasShieldOrHeal: boolean;
  hasLongRange: boolean;
}

/** Per-ability (P/Q/W/E/R) detail from the same Meraki fetch KeyTags above
 * already made for this candidate — name + per-rank cooldown/cost, plus max
 * cast range (see AbilityDetailList). Same top-N-only limit as keyTags. */
interface AbilityDetail {
  key: "P" | "Q" | "W" | "E" | "R";
  name: string;
  cooldown?: number[];
  cost?: number[];
  maxRange?: number;
  /** 서버(toAbilityDetails, src/lib/championSkills.ts)에서 판단한 "주요
   * 스킬 여부" — CC/기동성/보호막/회복 키워드에 걸린 스킬만 true. 순수
   * 데미지 스킬은 걸리지 않을 수 있다는 같은 한계가 적용됨(서버 쪽 doc
   * comment 참고). "주요 스킬여부를 판단해줘" 요청으로 추가. */
  isKeySkill: boolean;
}

interface CounterEntry {
  championId: number;
  name: string;
  iconUrl: string;
  winRate: number;
  games: number;
  bySource: SourceValue[];
  keyTags?: KeyTags;
  abilityDetails?: AbilityDetail[];
  conceptFits?: CompConceptId[];
  /** lol.ps head-to-head laning-phase stats (this champion vs the counter) —
   * only on the top few entries. See LaningTipList/buildLaningTips for the
   * "라인전 팁" derived from this. */
  laningStats?: VersusStats | null;
  /** lol.ps power curve for THIS counter — only on the top few entries. */
  earlyWinRate?: number | null;
  lateWinRate?: number | null;
  powerCurveLaneNote?: string | null;
  /** Full per-minute win-rate line behind earlyWinRate/lateWinRate above —
   * see PowerCurveDetails. */
  powerCurvePoints?: { minute: number; winRate: number }[] | null;
  /** How much the looked-up champion's power curve favors them against THIS
   * counter — 0.5 neutral, up to 1.0. A high value means: even though this
   * champion is a real statistical counter, your side's early/late-game
   * window may still work in your favor. */
  powerCurveVsMineFit?: number;
}

interface CounterResult {
  champion: ChampionBrief;
  position: string;
  sourcesSucceeded: number;
  sourcesAttempted: number;
  sourceErrors: SourceErrorInfo[];
  counters: CounterEntry[];
}

interface PickEntry {
  championId: number;
  name: string;
  iconUrl: string;
  winRate: number;
  games: number;
  bySource: SourceValue[];
  earlyWinRate?: number | null;
  lateWinRate?: number | null;
  /** Set when earlyWinRate/lateWinRate are actually lol.ps's data for a
   * different lane than this candidate's recommended position — lol.ps only
   * ever tracks a champion's own primary lane. */
  powerCurveLaneNote?: string | null;
  /** Full per-minute win-rate line behind earlyWinRate/lateWinRate above —
   * see PowerCurveDetails. */
  powerCurvePoints?: { minute: number; winRate: number }[] | null;
  build?: BuildResult | null;
  /** DeepLoL's build for the same champion+position, shown alongside `build`
   * rather than merged with it — same "라인 카운터"/"빌드" tab convention. */
  buildDeeplol?: BuildResult | null;
  /** Set only when the caller declared a champion pool — see ChampionPool below. */
  tier?: 1 | 2 | 3;
  /** How well this candidate fits the full enemy roster filled in so far
   * (tags/stats heuristic, not a win rate) — 0.5 neutral, up to 1. */
  compFit?: number;
  /** Real measured synergy against every already-picked ally (not a
   * heuristic) — how many of them this candidate is a top synergy partner
   * for, out of how many, plus the average measured win rate across just
   * those matches. */
  allySynergyMatchCount?: number;
  allySynergyOutOf?: number;
  allySynergyAvgWinRate?: number | null;
  /** Head-to-head laning-phase stats vs the specific enemy laner — only set
   * on counter-pick candidates (no single enemy laner to compare against
   * for bottom-duo synergy candidates). */
  laningStats?: VersusStats | null;
  /** How much this candidate's own early/late power curve favors them
   * against the SPECIFIC enemy laner (not the team-wide peak-phase fit
   * already blended into allySynergyFit) — 0.5 neutral, up to 1.0. Only set
   * on counter-pick candidates, same constraint as laningStats above. */
  powerCurveVsEnemyFit?: number;
  /** "핵심 태그" (see KeyTags above) — only on the top few entries. */
  keyTags?: KeyTags;
  /** 스킬 상세(P/Q/W/E/R 이름+쿨타임/코스트/사거리) — see AbilityDetail
   * above. Same top-N-only limit. */
  abilityDetails?: AbilityDetail[];
  /** Which of the 5 known comp concepts this candidate individually fits
   * (게임 스타일) — app-curated, not measured data (see compConcepts.ts
   * server-side and CONCEPT_PILOT_TIPS below for the same caveat elsewhere
   * in this file). Only on the top few entries. */
  conceptFits?: CompConceptId[];
}

/** "내 픽 추천" fallback for when the direct lane opponent isn't filled in
 * yet — no real matchup win rate exists to show without one (counterPicks
 * stays null instead), so this ranks candidates from the user's own
 * champion pool for this position using only compFit(태그 기반 상대 조합
 * 적합도)/allySynergy(실측 아군 시너지) — see computeCompFitPicks,
 * src/app/api/pickadvice/route.ts. Deliberately has no winRate/games/
 * bySource fields (unlike PickEntry) — there's no real per-candidate number
 * here, and showing a fake one would look like real data. */
interface CompFitPickEntry {
  championId: number;
  name: string;
  iconUrl: string;
  compFit: number;
  allySynergyFit: number;
  allySynergyMatchCount: number;
  allySynergyOutOf: number;
  allySynergyAvgWinRate: number | null;
  tier?: 1 | 2 | 3;
  keyTags?: KeyTags;
  abilityDetails?: AbilityDetail[];
  conceptFits?: CompConceptId[];
}

interface CombinedPickEntry {
  championId: number;
  name: string;
  iconUrl: string;
  counterWinRate: number;
  counterGames: number;
  synergyWinRate: number;
  synergyGames: number;
  score: number;
  tier?: 1 | 2 | 3;
  compFit?: number;
}

interface VersusLaneSide {
  goldAt15: number;
  xpAt15: number;
  csAt15: number;
  soloKillBefore15: number;
  maxLevelLead: number;
}

interface VersusStats {
  games: number;
  ally: VersusLaneSide;
  enemy: VersusLaneSide;
  allyLevel6FirstRate: number | null;
}

interface LaneSynergyEntry {
  position: string;
  ally: ChampionBrief;
  enemy: ChampionBrief;
  winRate: number | null;
  games: number | null;
  bySource: SourceValue[];
  laningStats: VersusStats | null;
  error: string | null;
}

interface DuoSynergyEntry {
  adc: ChampionBrief;
  support: ChampionBrief;
  winRate: number | null;
  games: number | null;
  bySource: SourceValue[];
  error: string | null;
}

interface MeasuredSynergy {
  lanes: LaneSynergyEntry[];
  duo: DuoSynergyEntry | null;
  overallScore: number | null;
}

interface DamageBalance {
  physicalPct: number;
  magicPct: number;
  sampledCount: number;
}

type AdcAttribute = "critAttackSpeed" | "attackSpeed" | "percentDamage" | "critDamage" | "spellblade";

interface AdcArchetypeEntry {
  championId: number;
  attributes: AdcAttribute[];
  flexibleBuild: boolean;
}

type TankAttribute = "shield" | "armor" | "damageReduction" | "regen" | "health";

interface TankArchetypeEntry {
  championId: number;
  attributes: TankAttribute[];
}

type BruiserAttribute = "lifesteal" | "attackSpeed" | "tanky" | "utility";

interface BruiserArchetypeEntry {
  championId: number;
  attributes: BruiserAttribute[];
}

interface TeamCompAnalysis {
  filledCount: number;
  tagCounts: Record<string, number>;
  damageBalance: DamageBalance | null;
  hasFrontline: boolean;
  adcArchetypes: AdcArchetypeEntry[];
  tankArchetypes: TankArchetypeEntry[];
  bruiserArchetypes: BruiserArchetypeEntry[];
}

interface CompHeuristic {
  ally: TeamCompAnalysis | null;
  enemy: TeamCompAnalysis | null;
}

type CompConceptId = "engage" | "poke" | "protect" | "teamfight" | "splitPush";

interface CompConceptScore {
  id: CompConceptId;
  matchCount: number;
  matchedChampionIds: number[];
}

interface CompConceptAnalysis {
  filledCount: number;
  scores: CompConceptScore[];
  dominant: CompConceptId | null;
}

interface ConceptMatchup {
  favors: CompConceptId;
  against: CompConceptId;
  reason: string;
}

interface CompConcepts {
  ally: CompConceptAnalysis | null;
  enemy: CompConceptAnalysis | null;
  matchup: ConceptMatchup | null;
}

interface LanerPowerCurve {
  position: string;
  champion: ChampionBrief;
  earlyWinRate: number | null;
  midWinRate: number | null;
  lateWinRate: number | null;
  powerCurvePoints: PowerCurvePoint[];
  laneNote: string | null;
}

interface TeamPowerCurve {
  laners: LanerPowerCurve[];
  teamEarlyWinRate: number | null;
  teamMidWinRate: number | null;
  teamLateWinRate: number | null;
  sampledCount: number;
}

interface ChampionCCInfo {
  championId: number;
  hasHardCC: boolean;
  hasSoftCC: boolean;
}

interface CCInfo {
  ally: ChampionCCInfo[];
  enemy: ChampionCCInfo[];
  allyCount: number;
  enemyCount: number;
}

interface AdviceResult {
  position: string;
  enemyLaneChampion: ChampionBrief | null;
  allyAdcChampion: ChampionBrief | null;
  championPoolActive: boolean;
  counterPicks: PickEntry[] | null;
  counterError: string | null;
  compFitPicks: CompFitPickEntry[] | null;
  synergyPicks: PickEntry[] | null;
  synergyError: string | null;
  combinedPicks: CombinedPickEntry[];
  measuredSynergy: MeasuredSynergy;
  compHeuristic: CompHeuristic;
  compConcepts: CompConcepts;
  ccInfo: CCInfo;
  teamPowerCurve: TeamPowerCurve;
}

/** "조합 비교" 탭 전용 — 포지션 없이 우리팀/상대팀 각 로스터(최대 5명)의
 * 파워 커브/조합 분석/조합 컨셉을 담는다. 서버(`/api/compcompare`)가
 * analyzeTeamComp/analyzeCompConcepts를 그대로 재사용해 계산한 값이라
 * TeamCompAnalysis/CompConceptAnalysis 타입도 위 픽 추천 쪽과 동일. */
interface RosterPowerCurveEntry extends ChampionBrief {
  earlyWinRate: number | null;
  midWinRate: number | null;
  lateWinRate: number | null;
  powerCurvePoints: PowerCurvePoint[];
}

interface RosterPowerCurve {
  perChampion: RosterPowerCurveEntry[];
  teamEarlyWinRate: number | null;
  teamMidWinRate: number | null;
  teamLateWinRate: number | null;
  sampledCount: number;
}

interface RosterCCEntry {
  championId: number;
  hasHardCC: boolean;
  hasSoftCC: boolean;
}

interface RosterAnalysis {
  champions: ChampionBrief[];
  compHeuristic: TeamCompAnalysis | null;
  compConcepts: CompConceptAnalysis | null;
  powerCurve: RosterPowerCurve;
  ccInfo: RosterCCEntry[];
}

/** 상대 5명 중 "내 포지션 기준 표본이 가장 많은"(=내 맞 라이너일 확률이
 * 가장 높은) 상위 3명 각각에 대한 카운터 픽 추천 — "추천형식은 픽 추천과
 * 같게" 요청에 맞춰 서버가 픽 추천의 PickEntry와 완전히 같은 필드 형식으로
 * 내려주므로, 여기서도 그대로 PickEntry를 재사용해서 WinRateBar/
 * CompFitBadge/SourceBreakdown 같은 기존 컴포넌트를 그대로 쓸 수 있다. */
interface LikelyEnemyLaner {
  champion: ChampionBrief;
  /** 이 챔피언이 실제로 이 포지션에서 나온 것으로 보이는 표본 게임 수
   * 합계 — "확률이 높다"고 판단한 근거 수치를 그대로 노출. */
  totalGames: number;
  counterPicks: PickEntry[];
}

interface CompCompareResult {
  ally: RosterAnalysis;
  enemy: RosterAnalysis;
  conceptMatchup: ConceptMatchup | null;
  likelyEnemyLaners: LikelyEnemyLaner[];
}

const COMP_CONCEPT_LABELS: Record<CompConceptId, string> = {
  engage: "돌진/이니시",
  poke: "포킹",
  protect: "쌍포/보호",
  teamfight: "한타",
  splitPush: "스플릿 푸시",
};

/** How to pilot each comp concept, shown under our own team's card when
 * that concept is dominant. Same footing as CONCEPT_MATCHUPS server-side —
 * general LoL strategy knowledge (not measured data, not computed from any
 * per-request signal), kept here since it's purely static presentational
 * content, matching how COMP_CONCEPT_LABELS/TAG_LABELS are also just
 * frontend-local lookup tables rather than round-tripped through the API. */
const CONCEPT_PILOT_TIPS: Record<CompConceptId, string[]> = {
  engage: [
    "핵심 딜러(원거리 딜러·마법사)부터 끊는 각을 보고 들어가세요 — 아무나 물면 역으로 둘러싸입니다.",
    "혼자 다이브하지 말고 팀 CC와 함께 들어가야 이니시가 오래 유지됩니다.",
    "상대 진형이 흩어졌을 때를 노리세요 — 뭉쳐있을 때 들어가면 받아쳐집니다.",
  ],
  poke: [
    "정면 교전을 피하고 사거리 밖에서 스킬로 지속적으로 딜을 넣으세요.",
    "상대가 무리하게 들어올 때만 짧게 교전하고 바로 빠지세요.",
    "오브젝트 앞에서 미리 소모시킨 뒤 유리할 때만 싸움을 여세요.",
  ],
  protect: [
    "캐리를 팀원들이 감싸고, 캐리는 안전 거리에서 딜만 넣으세요.",
    "보호막·CC는 캐리에게 우선 사용하고, 무리한 선타는 자제하세요.",
    "한타에서 캐리가 죽지 않으면 시간이 지날수록 유리해집니다 — 서두르지 마세요.",
  ],
  teamfight: [
    "진형을 잡고 5:5를 유도하세요 — 무리한 단독 교전은 피하세요.",
    "핵심 CC(궁극기)를 먼저 쓰기보다 상대가 먼저 쓰게 유도하세요.",
    "오브젝트(바론·드래곤) 앞 교전을 적극적으로 노리세요.",
  ],
  splitPush: [
    "사이드 라인을 지속적으로 압박하고, 상대가 몰려오면 빠지세요.",
    "텔레포트·귀환 타이밍을 계산해서 다른 라인 교전에 합류하세요.",
    "무리하게 혼자 오브젝트를 다투지 말고 라인 CS·타워를 우선하세요.",
  ],
};

/** How to play AGAINST each comp concept, shown under the enemy team's card
 * when that concept is dominant on their side. Same static-knowledge
 * footing as CONCEPT_PILOT_TIPS above. */
const CONCEPT_COUNTER_TIPS: Record<CompConceptId, string[]> = {
  engage: [
    "무리하게 앞으로 나가지 말고, 스킬 CC로 이니시 각을 미리 끊으세요.",
    "핵심 캐리는 항상 팀원 뒤에 두고, 플래시·보호기를 아끼세요.",
    "그룹 상태에서 갑자기 갭클로저가 들어오면 흩어져서 각개 대응하세요.",
  ],
  poke: [
    "뭉쳐서 스킬을 오래 맞지 말고, 사거리 안에서만 짧게 교전하세요.",
    "장막·은신 등으로 스킬 각을 피하며 접근하세요.",
    "빠르게 거리를 좁혀서 포킹 챔피언을 근접전으로 끌어들이세요.",
  ],
  protect: [
    "캐리를 직접 노리기보다 보호막·CC를 먼저 소모시키세요.",
    "여러 방향에서 접근해 보호를 분산시키세요.",
    "장기전보다 빠른 승부(오브젝트 스틸, 스플릿)로 게임을 짧게 가져가세요.",
  ],
  teamfight: [
    "5:5를 피하고 갈라져서 사이드 라인 이득을 챙기세요.",
    "시야로 상대 동선을 파악해 불리한 한타를 피하세요.",
    "핵심 CC 궁극기 쿨타임을 파악하고 그 타이밍에만 교전하세요.",
  ],
  splitPush: [
    "1:1로 상대하지 말고 2인 이상으로 스플릿 챔피언을 견제하세요.",
    "스플릿 챔피언이 혼자 있을 때 팀 전체가 다른 목표(오브젝트)를 챙기세요.",
    "시야로 스플릿 챔피언 위치를 계속 확인해 기습을 피하세요.",
  ],
};

/** One position's champion pool, split by mastery tier (1 = most
 * proficient). */
type TierBucket = Record<1 | 2 | 3, number[]>;
const EMPTY_TIER_BUCKET: TierBucket = { 1: [], 2: [], 3: [] };

/** User-declared champion pool for 픽 추천, one tier bucket PER POSITION —
 * a champion registered while looking at "탑" only restricts/prioritizes 탑
 * recommendations, not 정글/미드/etc, since the same champion pool used to
 * apply everywhere regardless of which position tab was open (registering
 * Lux for mid would also make her show up as a suggested top pick). Keyed
 * by the same `position` state the rest of advice mode already uses for
 * "내 포지션", so switching that tab naturally switches which pool you're
 * looking at/editing — no separate UI surface needed. Persisted to
 * localStorage so it survives reloads — there's no backend/DB in this app,
 * so the browser is the only place it can live. A position's empty bucket
 * (all three tiers empty) means "no restriction for this position",
 * matching the server's default behavior. */
type ChampionPool = Record<Position, TierBucket>;
const EMPTY_POOL: ChampionPool = Object.fromEntries(
  POSITIONS.map((p) => [p.value, EMPTY_TIER_BUCKET]),
) as ChampionPool;
const POOL_STORAGE_KEY = "semips-champion-pool";

/** True when `v` looks like a valid TierBucket — used both to validate what
 * comes back out of localStorage (arbitrary/corrupt JSON) and, as a side
 * effect, to safely no-op on the OLD pre-per-position storage shape (a bare
 * `{1: [...], 2: [...], 3: [...]}` with no position keys) rather than
 * crashing or misinterpreting it — that old shape just fails this check for
 * every position and falls back to EMPTY_TIER_BUCKET, a one-time silent
 * reset instead of a broken pool. */
function isValidTierBucket(v: unknown): v is TierBucket {
  if (typeof v !== "object" || v === null) return false;
  const b = v as Record<string, unknown>;
  return ([1, 2, 3] as const).every((t) => Array.isArray(b[t]));
}

/** How many entries 픽 추천's recommendation lists (라인전 유리한 픽/시너지
 * 좋은 픽/둘 다 좋은 픽) show — sent as the `count` query param, matching
 * RECOMMEND_COUNT_OPTIONS in the API route (src/app/api/pickadvice/route.ts).
 * Kept as a plain literal union (not persisted) — same as position/mode,
 * which also reset to a sane default on reload rather than remembering the
 * user's last choice. */
type RecommendCount = 5 | 10 | 15;
const RECOMMEND_COUNT_OPTIONS: RecommendCount[] = [5, 10, 15];

interface Slot {
  key: string;
  label: string;
  championId: number | null;
}

/** Advice mode shows a full 10-slot draft board (5 ally + 5 enemy
 * positions) so it feels like an actual champion-select screen. Two of
 * those ten slots feed the single-pick recommendation (the enemy pick in my
 * own position, and — when I'm picking support — our ADC); beyond that,
 * whichever ally/enemy pairs are filled in also feed the "measured"
 * lane-by-lane + duo synergy comparison and the tag-based comp analysis
 * further down the results — see the hint text rendered alongside the
 * board for exactly which. My own position's ally slot ("내 픽") used to be
 * locked (never fillable, reserved purely as "what am I being recommended
 * a pick for") — it's a normal fillable slot like any other now, just
 * tagged with a small badge (see renderChampSelectSlot) — filling it in
 * lets you preview the full comp (조합 분석/조합 컨셉/CC/파워 커브) with your
 * actual pick included, not just the other 9 slots. The recommendation
 * lists still work independently of whether this slot is filled — they're
 * keyed off the ENEMY laner slot, not this one. */
function adviceSlotsFor(): Slot[] {
  return [
    ...POSITIONS.map((p) => ({
      key: `ally-${p.value}`,
      label: `우리팀 ${p.label}`,
      championId: null,
    })),
    ...POSITIONS.map((p) => ({
      key: `enemy-${p.value}`,
      label: `상대 ${p.label}`,
      championId: null,
    })),
  ];
}

/** "조합 비교" 탭 전용 10슬롯 — 픽 추천의 adviceSlotsFor와 달리 포지션
 * 구분이 전혀 없다(사용자 요청: "포지션을 구분하지 않고 챔피언만 빠르게
 * 비교"). 그냥 우리팀/상대팀 각 5자리. 키 접두사(compally-/compenemy-)는
 * advice 모드의 ally-/enemy- 접두사와 실제로 겹칠 일은 없지만(모드가
 * 바뀌면 slots 배열 자체가 통째로 교체됨) 헷갈리지 않게 구분해뒀다. */
function compCompareSlotsFor(): Slot[] {
  return [
    ...Array.from({ length: 5 }, (_, i) => ({
      key: `compally-${i}`,
      label: `우리팀 챔피언 ${i + 1}`,
      championId: null,
    })),
    ...Array.from({ length: 5 }, (_, i) => ({
      key: `compenemy-${i}`,
      label: `상대팀 챔피언 ${i + 1}`,
      championId: null,
    })),
  ];
}

/** Same version-less Data Dragon path convention as rune icons
 * (ddragon.ts's runeIconUrl) — splash art doesn't take a patch version
 * segment. `slug` is Data Dragon's own champion id string (e.g. "Kaisa"),
 * already sent by /api/champions. */
function championSplashUrl(slug: string): string {
  return `https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${slug}_0.jpg`;
}

/** Short one/two-glyph role tag shown in advice mode's champ-select-style
 * slots — the slot's fixed position in the column already conveys role
 * (positions are always listed top→jungle→mid→adc→support), this is just a
 * quick visual anchor matching real champ select's role icons. */
const POSITION_SHORT_LABEL: Record<string, string> = {
  top: "탑",
  jungle: "정글",
  mid: "미드",
  adc: "원딜",
  support: "서폿",
};

const TAG_LABELS: Record<string, string> = {
  Fighter: "전사",
  Tank: "탱커",
  Mage: "마법사",
  Assassin: "암살자",
  Support: "서포터",
  Marksman: "원거리 딜러",
};

const ADC_ATTRIBUTE_LABELS: Record<AdcAttribute, string> = {
  critAttackSpeed: "치명타/공속",
  attackSpeed: "공속",
  percentDamage: "퍼센트 데미지",
  critDamage: "치명타 데미지",
  spellblade: "주문검",
};

const TANK_ATTRIBUTE_LABELS: Record<TankAttribute, string> = {
  shield: "보호막 탱커",
  armor: "방어력 탱커",
  damageReduction: "데미지 감소 탱커",
  regen: "회복 탱커",
  health: "체력 탱커",
};

const BRUISER_ATTRIBUTE_LABELS: Record<BruiserAttribute, string> = {
  lifesteal: "흡혈 브루저",
  attackSpeed: "공속 브루저",
  tanky: "탱킹 브루저",
  utility: "유틸 브루저",
};

function CompCard({
  title,
  analysis,
  championById,
}: {
  title: string;
  analysis: TeamCompAnalysis;
  championById: Map<number, ChampionSummary>;
}) {
  return (
    <div className="comp-card">
      <h4>
        {title} ({analysis.filledCount}명 입력됨)
      </h4>
      <p className="empty-hint">
        {Object.entries(analysis.tagCounts)
          .map(([tag, count]) => `${TAG_LABELS[tag] ?? tag} ${count}`)
          .join(" · ")}
      </p>
      <p className="empty-hint">프론트라인(탱커): {analysis.hasFrontline ? "있음" : "없음"}</p>
      {analysis.damageBalance && (
        <p className="empty-hint">
          물리 {analysis.damageBalance.physicalPct}% · 마법 {analysis.damageBalance.magicPct}%
          {(analysis.damageBalance.physicalPct >= 75 || analysis.damageBalance.magicPct >= 75) &&
            " (한쪽으로 치우침 — 상대가 방어구/마법저항 몰아주기 쉬워요)"}
        </p>
      )}
      {analysis.adcArchetypes.length > 0 &&
        analysis.adcArchetypes.map((a) => {
          const champ = championById.get(a.championId);
          return (
            <p key={a.championId} className="empty-hint">
              {champ?.name ?? "원거리 딜러"}: {a.attributes.map((attr) => ADC_ATTRIBUTE_LABELS[attr]).join(" · ")}
              {a.flexibleBuild && <span className="adc-flex-badge">빌드 유동적</span>}
            </p>
          );
        })}
      {analysis.tankArchetypes.length > 0 &&
        analysis.tankArchetypes.map((t) => {
          const champ = championById.get(t.championId);
          return (
            <p key={t.championId} className="empty-hint">
              {champ?.name ?? "탱커"}: {t.attributes.map((attr) => TANK_ATTRIBUTE_LABELS[attr]).join(" · ")}
            </p>
          );
        })}
      {analysis.bruiserArchetypes.length > 0 &&
        analysis.bruiserArchetypes.map((b) => {
          const champ = championById.get(b.championId);
          return (
            <p key={b.championId} className="empty-hint">
              {champ?.name ?? "브루저"}: {b.attributes.map((attr) => BRUISER_ATTRIBUTE_LABELS[attr]).join(" · ")}
            </p>
          );
        })}
    </div>
  );
}

/** How many of the filled champions fit each of the five known comp
 * concepts (돌진/포킹/쌍포/한타/스플릿) — see compConcepts.ts server-side.
 * Not a percentage or a rate; deliberately shown as a plain "N/필요 인원"
 * count so it doesn't read as more precise than the underlying heuristic
 * actually is. When a concept is dominant, also shows play tips — "pilot"
 * (how to play this comp) for our own team, "counter" (how to play against
 * it) for the enemy's — from the static CONCEPT_PILOT_TIPS/
 * CONCEPT_COUNTER_TIPS tables above. */
function CompConceptCard({
  title,
  analysis,
  tipsVariant,
}: {
  title: string;
  analysis: CompConceptAnalysis;
  tipsVariant: "pilot" | "counter";
}) {
  const tips = analysis.dominant
    ? (tipsVariant === "pilot" ? CONCEPT_PILOT_TIPS : CONCEPT_COUNTER_TIPS)[analysis.dominant]
    : null;
  return (
    <div className="comp-card">
      <h4>{title} 조합 컨셉</h4>
      {analysis.dominant ? (
        <p className="concept-dominant-label">{COMP_CONCEPT_LABELS[analysis.dominant]} 성향</p>
      ) : (
        <p className="empty-hint">뚜렷한 컨셉 없음 (혼합형)</p>
      )}
      <ul className="concept-score-list">
        {analysis.scores.map((s) => (
          <li key={s.id}>
            <span>{COMP_CONCEPT_LABELS[s.id]}</span>
            <span className="empty-hint">
              {s.matchCount}/{analysis.filledCount}명
            </span>
          </li>
        ))}
      </ul>
      {tips && (
        <>
          <p className="concept-tips-label">{tipsVariant === "pilot" ? "플레이 팁" : "대처 팁"}</p>
          <ul className="concept-tips-list">
            {tips.map((tip) => (
              <li key={tip}>{tip}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** Static concept-vs-concept strategic note (see CONCEPT_MATCHUPS in
 * compConcepts.ts) — only shown when BOTH sides have a clear dominant
 * concept AND there's an established note for that specific pair
 * (most cross-pairs involving 한타/스플릿 don't have one, by design). */
function ConceptMatchupNote({ matchup }: { matchup: ConceptMatchup | null }) {
  if (!matchup) return null;
  return (
    <p className="concept-matchup-note">
      일반적으로 <strong>{COMP_CONCEPT_LABELS[matchup.favors]}</strong>이(가){" "}
      <strong>{COMP_CONCEPT_LABELS[matchup.against]}</strong>에 유리한 편이에요 — {matchup.reason}. (실제 승률
      데이터가 아니라 일반적인 전략 경향입니다)
    </p>
  );
}

/** lol.ps power-curve badge — only present on the top few recommendation
 * entries (see POWER_CURVE_CANDIDATE_LIMIT server-side). */
function PowerCurveBadge({ earlyWinRate, lateWinRate }: { earlyWinRate?: number | null; lateWinRate?: number | null }) {
  if (earlyWinRate == null || lateWinRate == null) return null;
  const diff = lateWinRate - earlyWinRate;
  const lean = diff >= 0.03 ? " (후반형)" : diff <= -0.03 ? " (초반형)" : "";
  return (
    <span className="power-curve-badge">
      lol.ps 파워 커브 · 초반 {(earlyWinRate * 100).toFixed(1)}% · 후반 {(lateWinRate * 100).toFixed(1)}%
      {lean}
    </span>
  );
}

const POWER_CURVE_SPARKLINE_WIDTH = 280;
const POWER_CURVE_SPARKLINE_HEIGHT = 56;

/** Expandable per-minute detail behind PowerCurveBadge's 3-bucket summary —
 * a small inline SVG sparkline (no charting library — this app has never
 * pulled one in, and a 31-point line is simple enough to draw by hand) plus
 * the exact per-minute win rates, both driven by the same raw
 * PowerCurvePoint[] lol.ps's graphs.json returns (minute 3..33, ~31 points)
 * that earlyWinRate/midWinRate/lateWinRate elsewhere in this file are just a
 * 3-bucket average of — averaging into three buckets can hide a real shape
 * (e.g. a champion strong specifically around minute 10 and again past
 * minute 25, but weak in between, nets out to an unremarkable "mid"
 * average). Renders nothing when there's no point data, same as
 * PowerCurveBadge — most call sites pass the very same entry's points. */
function PowerCurveDetails({ points }: { points?: PowerCurvePoint[] | null }) {
  if (!points || points.length < 2) return null;

  const winRates = points.map((p) => p.winRate);
  // Padding the min/max with 0.5 (neutral) keeps a nearly-flat line from
  // getting visually exaggerated into a dramatic zigzag by an auto-scaled
  // axis with almost no real range.
  const minRate = Math.min(...winRates, 0.5);
  const maxRate = Math.max(...winRates, 0.5);
  const range = Math.max(maxRate - minRate, 0.01);
  const x = (i: number) => (i / (points.length - 1)) * POWER_CURVE_SPARKLINE_WIDTH;
  const y = (rate: number) => POWER_CURVE_SPARKLINE_HEIGHT - ((rate - minRate) / range) * POWER_CURVE_SPARKLINE_HEIGHT;
  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p.winRate).toFixed(1)}`)
    .join(" ");
  const neutralY = y(0.5);

  const best = points.reduce((a, b) => (b.winRate > a.winRate ? b : a));
  const worst = points.reduce((a, b) => (b.winRate < a.winRate ? b : a));

  return (
    <Details label="분당 승률 상세">
      <svg
        className="power-curve-sparkline"
        viewBox={`0 0 ${POWER_CURVE_SPARKLINE_WIDTH} ${POWER_CURVE_SPARKLINE_HEIGHT}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="분당 승률 그래프"
      >
        {neutralY >= 0 && neutralY <= POWER_CURVE_SPARKLINE_HEIGHT && (
          <line
            x1={0}
            y1={neutralY}
            x2={POWER_CURVE_SPARKLINE_WIDTH}
            y2={neutralY}
            className="power-curve-sparkline-neutral"
          />
        )}
        <path d={path} className="power-curve-sparkline-line" fill="none" />
      </svg>
      <p className="empty-hint">
        {points[0].minute}분 {(points[0].winRate * 100).toFixed(1)}% → {points[points.length - 1].minute}분{" "}
        {(points[points.length - 1].winRate * 100).toFixed(1)}% · 최고 {best.minute}분 {(best.winRate * 100).toFixed(1)}
        % · 최저 {worst.minute}분 {(worst.winRate * 100).toFixed(1)}%
      </p>
      <div className="power-curve-detail-table">
        {points.map((p) => (
          <span key={p.minute} className="power-curve-detail-cell">
            <span className="power-curve-detail-minute">{p.minute}분</span>
            <span className="power-curve-detail-rate">{(p.winRate * 100).toFixed(1)}%</span>
          </span>
        ))}
      </div>
    </Details>
  );
}

/** Shown when the candidate's own power curve gives it a real early/late-game
 * edge over the SPECIFIC opponent being compared against (the enemy laner in
 * pick-advice, or the looked-up champion's own matchup in the lane-counter
 * tab) — see powerCurveVsFitScore, src/lib/sources/lolps.ts. Same 0.5-neutral,
 * only-shows-when-favorable convention as CompFitBadge, and explicitly a
 * different signal from PowerCurveBadge's raw early/late % (this is a
 * head-to-head comparison, not a standalone number). */
function PowerCurveVsEnemyBadge({ fit }: { fit?: number }) {
  if (fit == null || fit <= 0.5) return null;
  const label = fit >= 0.85 ? "파워 커브상 상대보다 크게 유리" : "파워 커브상 상대보다 유리";
  return <span className="power-curve-vs-badge">{label}</span>;
}

/** Shown when the server's tag-based heuristic found this candidate a good
 * fit against the FULL enemy roster filled in so far (not just the laner) —
 * see scoreEnemyCompFit in teamComp.ts. compFit is 0.5 at neutral (nothing
 * to say) and only ever goes up from there, so this only renders when it's
 * actually above neutral — no badge is itself information (means neither of
 * the two signals applied). Explicitly NOT a win rate, so it's worded and
 * styled differently from WinRateBar/PowerCurveBadge. */
function CompFitBadge({ compFit }: { compFit?: number }) {
  if (compFit == null || compFit <= 0.5) return null;
  const label = compFit >= 1 ? "상대팀 조합에 매우 적합" : "상대팀 조합에 적합";
  return <span className="comp-fit-badge">{label}</span>;
}

/** Real measured synergy against every already-picked ally — "우리팀에
 * 2,3,4,5가 있을 때 각각과 시너지 좋은 챔피언의 교집합" 요청으로 추가된
 * 배지. matchCount/outOf가 이 챔피언이 몇 명의 아군과 실제로(스크래핑된
 * 데이터 기준) 상위 시너지 파트너로 겹치는지를 그대로 보여주고,
 * matchCount === outOf일 때가 진짜 "교집합"(전원과 시너지 좋음)입니다.
 * outOf가 0(채워진 아군 없음)이거나 matchCount가 0(아무와도 안 겹침)이면
 * 표시할 정보가 없으므로 렌더링하지 않습니다. */
function AllySynergyBadge({
  matchCount,
  outOf,
  avgWinRate,
}: {
  matchCount?: number;
  outOf?: number;
  avgWinRate?: number | null;
}) {
  if (!outOf || !matchCount) return null;
  const label = matchCount === outOf ? "우리팀 전원과 시너지 좋음" : `우리팀 ${outOf}명 중 ${matchCount}명과 시너지 좋음`;
  return (
    <span className="ally-synergy-badge">
      {label}
      {avgWinRate != null && ` (평균 ${(avgWinRate * 100).toFixed(1)}%)`}
    </span>
  );
}

/** Compact chip labels for KeyTags — order matches championSkills.ts's
 * declaration order (hard CC first, most decisive signal). */
const KEY_TAG_LABELS: { key: keyof KeyTags; label: string }[] = [
  { key: "hasHardCC", label: "하드CC" },
  { key: "hasSoftCC", label: "둔화" },
  { key: "hasMobility", label: "기동성" },
  { key: "hasShieldOrHeal", label: "보호막/회복" },
  { key: "hasLongRange", label: "장거리" },
];

/** "핵심 태그" chips — this app's own classification of REAL ability text
 * (Meraki Analytics, see championSkills.ts), not a win rate. Only renders
 * the tags that are actually true; nothing shown at all when keyTags wasn't
 * attached (candidate outside the top-N fetch limit) or none of the five
 * tags apply. */
function KeyTagBadges({ tags }: { tags?: KeyTags }) {
  if (!tags) return null;
  const active = KEY_TAG_LABELS.filter((t) => tags[t.key]);
  if (active.length === 0) return null;
  return (
    <span className="key-tag-row" title="이 챔피언의 실제 스킬 텍스트에서 이 앱이 분류한 핵심 태그입니다">
      {active.map((t) => (
        <span key={t.key} className="key-tag-chip">
          {t.label}
        </span>
      ))}
    </span>
  );
}

const ABILITY_KEY_LABELS: Record<AbilityDetail["key"], string> = { P: "패시브", Q: "Q", W: "W", E: "E", R: "R" };

/** "상세 정보 제공을 늘려줘" — Meraki에서 가져온 스킬별 쿨타임/코스트/
 * 사거리를 랭크별로 보여주는 접이식 목록. keyTags/conceptFits와 같은 top-N
 * 한정 데이터라 abilityDetails가 아예 없으면(그 후보가 top-N 밖이거나
 * Meraki 조회 자체가 실패) 아무것도 렌더링하지 않는다. 쿨타임/코스트가
 * 파싱되지 않은 스킬(값 없음)은 그 항목만 조용히 생략 — "0"처럼 잘못된
 * 값을 보여주는 대신 아예 안 보여주는 쪽을 택함. "주요 스킬여부를
 * 판단해줘" 요청으로, CC/기동성/보호막/회복 키워드에 걸린 스킬(isKeySkill)
 * 옆에 "주요" 배지를 붙인다 — 순수 데미지기만 있는 스킬은 이 휴리스틱상
 * 안 걸릴 수 있다는 한계는 AbilityDetail의 doc comment 참고. */
function AbilityDetailList({ abilities }: { abilities?: AbilityDetail[] }) {
  if (!abilities || abilities.length === 0) return null;
  return (
    <Details label="스킬 상세">
      <ul className="ability-detail-list">
        {abilities.map((a) => (
          <li key={a.key} className="ability-detail-row">
            <span className="ability-detail-key">{ABILITY_KEY_LABELS[a.key]}</span>
            <span className="ability-detail-name">
              {a.name || "(이름 없음)"}
              {a.isKeySkill && (
                <span
                  className="ability-detail-key-badge"
                  title="CC/기동성/보호막/회복 등 라인전에 영향을 주는 텍스트가 있는 스킬"
                >
                  주요
                </span>
              )}
            </span>
            <span className="ability-detail-numbers">
              {a.cooldown && a.cooldown.length > 0 && <>쿨타임 {a.cooldown.join("/")}초 </>}
              {a.cost && a.cost.length > 0 && <>코스트 {a.cost.join("/")} </>}
              {a.maxRange != null && <>사거리 {a.maxRange}</>}
            </span>
          </li>
        ))}
      </ul>
    </Details>
  );
}

/** "게임 스타일" chips — which of compConcepts.ts's 5 known comp-concept
 * archetypes this ONE candidate individually fits (championConceptFit,
 * server-side). Explicitly NOT measured data — same "app-curated strategic
 * knowledge, not a win rate" caveat as CompConceptCard/CONCEPT_PILOT_TIPS
 * elsewhere in this file, just per-champion instead of per-team. */
function ConceptFitBadges({ fits }: { fits?: CompConceptId[] }) {
  if (!fits || fits.length === 0) return null;
  return (
    <span className="concept-fit-row" title="실측 승률이 아니라 이 앱이 분류한 게임 스타일 성향입니다">
      {fits.map((id) => (
        <span key={id} className="concept-fit-chip">
          {COMP_CONCEPT_LABELS[id]}
        </span>
      ))}
    </span>
  );
}

/** lol.ps versus/stats.json 기반 라인전 세부지표 — "실측 데이터 기반 전체
 * 시너지"의 각 라인 매치업(이미 아군/적군 챔피언과 라인이 둘 다 정해진
 * 상태)에 붙는 부가 정보. 15분 골드/경험치/CS는 아군 기준 차이(양수=아군
 * 우위)로, 나머지는 두 챔피언 실측 수치를 나란히 보여줌 — 전부 lol.ps가
 * 그 매치업+라인에서 실제로 집계한 값이고 가공된 지표가 아님. */
function LaningStatsRow({ stats }: { stats: VersusStats }) {
  const goldDiff = stats.ally.goldAt15 - stats.enemy.goldAt15;
  const xpDiff = stats.ally.xpAt15 - stats.enemy.xpAt15;
  const csDiff = stats.ally.csAt15 - stats.enemy.csAt15;
  const fmtDiff = (d: number) => `${d >= 0 ? "+" : ""}${Math.round(d).toLocaleString()}`;
  return (
    <div className="laning-stats">
      <div className="laning-stats-row">
        <span className={`laning-stat${goldDiff >= 0 ? " laning-stat--good" : " laning-stat--bad"}`}>
          15분 골드 {fmtDiff(goldDiff)}
        </span>
        <span className={`laning-stat${xpDiff >= 0 ? " laning-stat--good" : " laning-stat--bad"}`}>
          15분 경험치 {fmtDiff(xpDiff)}
        </span>
        <span className={`laning-stat${csDiff >= 0 ? " laning-stat--good" : " laning-stat--bad"}`}>
          15분 CS {fmtDiff(csDiff)}
        </span>
      </div>
      <p className="empty-hint">
        15분 이전 솔로킬 {stats.ally.soloKillBefore15.toFixed(1)} : {stats.enemy.soloKillBefore15.toFixed(1)} · 최대
        레벨 리드 {stats.ally.maxLevelLead.toFixed(1)} : {stats.enemy.maxLevelLead.toFixed(1)}
        {stats.allyLevel6FirstRate !== null &&
          ` · 6레벨 우위 ${(stats.allyLevel6FirstRate * 100).toFixed(0)}%`}{" "}
        · 표본 {stats.games.toLocaleString()}게임 (lol.ps)
      </p>
    </div>
  );
}

/** How large a real 15분 CS/솔로킬 차이 needs to be before it's worth turning
 * into a "라인전 팁" — same spirit as pickadvice's `laningFitScore` (±2000
 * gold = "roughly a full swing"), just for CS/solo-kill counts instead of
 * gold: there's no larger dataset here to calibrate an exact cutoff against,
 * so these are kept deliberately conservative/simple rather than
 * empirically derived. CS_LEAD_THRESHOLD (~10, roughly one minion wave) and
 * SOLO_KILL_LEAD_THRESHOLD (0.15 — solo kill counts run well under 1 per
 * game in most matchups, so even a small gap is meaningful) are both raw
 * counts, not percentages. */
const CS_LEAD_THRESHOLD = 10;
const SOLO_KILL_LEAD_THRESHOLD = 0.15;

/** Same "no larger dataset to calibrate against" caveat as the two
 * thresholds above, now applied to Meraki's per-ability cooldown/cost/range
 * numbers (`AbilityDetail`, see 상단 정의) instead of lol.ps's CS/솔로킬
 * counts — "쿨타임, 코스트, 사거리를 이용해서 라인전 팁을 재편성해줘".
 * POKE_RANGE_THRESHOLD(500)은 원거리 견제형 스킬과 근접형 스킬을 대략
 * 가르는 값(근접 챔피언 돌진기는 보통 200~350, 원거리 견제기는 500 이상),
 * POKE_COOLDOWN_THRESHOLD(8초)는 1랭크 쿨타임이 그보다 짧으면 라인전 내내
 * 반복해서 던질 수 있다고 본 값, POKE_LOW_COST_THRESHOLD(40)는 문장에
 * "코스트도 낮아"를 덧붙이는 보조 조건(그 자체로 팁 등장 여부를 가르지
 * 않음), PUNISH_COOLDOWN_THRESHOLD(16초)는 만랭 쿨타임이 그 이상이면 "한
 * 번 쓰고 나면 한동안 못 쓴다"고 볼 만큼 긴 값으로 잡았다. 모두 초 단위/
 * 게임 유닛 원값이지 퍼센트가 아니다. */
const POKE_RANGE_THRESHOLD = 500;
const POKE_COOLDOWN_THRESHOLD = 8;
const POKE_LOW_COST_THRESHOLD = 40;
const PUNISH_COOLDOWN_THRESHOLD = 16;

interface LaningTip {
  text: string;
  tone: "good" | "bad";
}

/** 이 후보/카운터의 P~R 스킬 중 "자주 던질 수 있는 장거리 견제기"로 부를
 * 만한 하나를 고른다 — 패시브(사거리/쿨타임 개념이 거의 없음)와 궁극기
 * (라인전 초반엔 대부분 못 씀)는 제외하고, 남은 Q/W/E 중 `isKeySkill`(CC/
 * 기동성/보호막/회복 텍스트가 있는 스킬 — "주요 스킬여부를 판단해줘")이면서
 * 사거리가 POKE_RANGE_THRESHOLD를 넘고 1랭크 쿨타임이
 * POKE_COOLDOWN_THRESHOLD 이하인 것만 후보로 삼아 그중 사거리가 가장 긴
 * 것을 반환한다. 조건 중 하나라도 데이터가 없거나(파싱 실패) 기준을 못
 * 넘으면 그 스킬은 아예 후보에서 빠진다 — 잘못된 추정으로 팁을 만드는
 * 것보다 안전. `isKeySkill` 조건 때문에 CC/기동성/보호막/회복 키워드가
 * 전혀 없는 순수 데미지형 견제 스킬(흔한 메이지 포킹 Q 등)은 사거리·
 * 쿨타임이 맞아도 여기 안 걸릴 수 있다 — AbilityDetail의 doc comment와
 * 같은 한계. */
function findPokeThreat(abilities: AbilityDetail[]): AbilityDetail | null {
  let best: AbilityDetail | null = null;
  for (const a of abilities) {
    if (a.key === "P" || a.key === "R") continue;
    if (!a.isKeySkill) continue;
    if (a.maxRange === undefined || a.maxRange < POKE_RANGE_THRESHOLD) continue;
    if (!a.cooldown || a.cooldown.length === 0 || a.cooldown[0] > POKE_COOLDOWN_THRESHOLD) continue;
    if (!best || a.maxRange > (best.maxRange ?? 0)) best = a;
  }
  return best;
}

/** 같은 abilities에서 이번엔 "한 번 쓰면 한동안 못 쓰는(=쓰고 나면
 * 약해지는) 핵심 스킬"을 고른다 — 패시브/궁극기는 위와 같은 이유로
 * 제외하고, `isKeySkill`인 Q/W/E 중 만랭 쿨타임(cooldown 배열의 마지막
 * 값)이 PUNISH_COOLDOWN_THRESHOLD를 넘는 것 중 가장 긴 것을 반환한다. */
function findPunishWindow(abilities: AbilityDetail[]): AbilityDetail | null {
  let best: AbilityDetail | null = null;
  for (const a of abilities) {
    if (a.key === "P" || a.key === "R") continue;
    if (!a.isKeySkill) continue;
    if (!a.cooldown || a.cooldown.length === 0) continue;
    const maxRankCooldown = a.cooldown[a.cooldown.length - 1];
    if (maxRankCooldown < PUNISH_COOLDOWN_THRESHOLD) continue;
    const bestMaxRankCooldown = best?.cooldown ? best.cooldown[best.cooldown.length - 1] : -1;
    if (!best || maxRankCooldown > bestMaxRankCooldown) best = a;
  }
  return best;
}

/** Turns lol.ps's real 15분 CS/솔로킬 head-to-head numbers (`VersusStats`,
 * already fetched for LaningStatsRow above) *and* Meraki's per-ability
 * cooldown/코스트/사거리 numbers (`AbilityDetail`, already fetched for
 * AbilityDetailList above) into short actionable Korean tips — computed
 * purely client-side from numbers the server already ships, same pattern as
 * `powerCurveLean`/`ccDotState` turning other raw real numbers into display
 * labels elsewhere in this app, rather than adding a server-side
 * text-generation step. `stats`/`abilityDetails`는 서로 독립적이라 한쪽이
 * 없어도 다른 쪽 팁은 그대로 뜬다. Returns at most four tips (CS/솔로킬
 * 기반 최대 2개 + 스킬 기반 최대 2개); returns none when no signal clears
 * its threshold — same "no badge is itself a (neutral) result" convention
 * as CompFitBadge. */
function buildLaningTips(stats: VersusStats | null | undefined, abilityDetails?: AbilityDetail[]): LaningTip[] {
  const tips: LaningTip[] = [];

  if (stats) {
    const csDiff = stats.ally.csAt15 - stats.enemy.csAt15;
    if (csDiff >= CS_LEAD_THRESHOLD) {
      tips.push({
        tone: "good",
        text: `15분 CS가 평균 ${csDiff.toFixed(1)}개 앞서는 매치업이에요 — 우위를 살려 라인을 밀고 상대를 압박해보세요.`,
      });
    } else if (csDiff <= -CS_LEAD_THRESHOLD) {
      tips.push({
        tone: "bad",
        text: `15분 CS가 평균 ${Math.abs(csDiff).toFixed(1)}개 밀리는 매치업이에요 — 무리한 교전보다 안전하게 CS 챙기기에 집중하세요.`,
      });
    }

    const soloDiff = stats.ally.soloKillBefore15 - stats.enemy.soloKillBefore15;
    if (soloDiff >= SOLO_KILL_LEAD_THRESHOLD) {
      tips.push({
        tone: "good",
        text: `이 매치업에서 우리가 솔로킬을 낸 경우가 상대보다 많았어요 — 상대가 무리하게 들어올 때 각을 노려보세요.`,
      });
    } else if (soloDiff <= -SOLO_KILL_LEAD_THRESHOLD) {
      tips.push({
        tone: "bad",
        text: `이 매치업에서 상대가 솔로킬을 낸 경우가 더 많았어요 — 혼자 스킬 맞을 상황을 만들지 않도록 주의하세요.`,
      });
    }
  }

  if (abilityDetails && abilityDetails.length > 0) {
    const pokeThreat = findPokeThreat(abilityDetails);
    if (pokeThreat && pokeThreat.cooldown && pokeThreat.maxRange !== undefined) {
      const lowCost = pokeThreat.cost !== undefined && pokeThreat.cost[0] <= POKE_LOW_COST_THRESHOLD;
      tips.push({
        tone: "bad",
        text: `상대 ${pokeThreat.name}(${pokeThreat.key}) 사거리가 ${pokeThreat.maxRange}로 길고 재사용 대기시간도 ${pokeThreat.cooldown[0]}초로 짧아${lowCost ? " 코스트도 낮아" : ""} 견제가 잦을 수 있어요 — 미니언 정리할 때 스킬 사거리 밖에서 대기하세요.`,
      });
    }

    const punishWindow = findPunishWindow(abilityDetails);
    if (punishWindow && punishWindow.cooldown) {
      const maxRankCooldown = punishWindow.cooldown[punishWindow.cooldown.length - 1];
      tips.push({
        tone: "good",
        text: `상대 ${punishWindow.name}(${punishWindow.key}) 재사용 대기시간이 만랭 기준 ${maxRankCooldown}초로 길어요 — 한 번 쓰고 나면 그 직후 공격적으로 교전을 걸어보세요.`,
      });
    }
  }

  return tips;
}

/** Renders buildLaningTips' output — nothing at all when both `stats`와
 * `abilityDetails`가 없거나(candidate outside the relevant
 * *_CANDIDATE_LIMIT server-side, lol.ps had no games for this exact
 * matchup+lane, or the Meraki fetch failed) 어느 신호도 기준을 못 넘으면,
 * 빈 블록을 남기지 않는다. `stats`/`abilityDetails`는 서로 독립적 —
 * 한쪽만 있어도 그쪽 팁은 뜬다. Shown outside the collapsed
 * "세부정보"/"소스별 상세" Details (unlike LaningStatsRow/AbilityDetailList의
 * raw numbers) since these are meant to be an immediately visible
 * suggestion, not a stat you have to expand to see. */
function LaningTipList({
  stats,
  abilityDetails,
}: {
  stats?: VersusStats | null;
  abilityDetails?: AbilityDetail[];
}) {
  const tips = buildLaningTips(stats, abilityDetails);
  if (tips.length === 0) return null;
  return (
    <ul className="laning-tip-list">
      {tips.map((t) => (
        <li key={t.text} className={`laning-tip laning-tip--${t.tone}`}>
          {t.text}
        </li>
      ))}
    </ul>
  );
}

/** Shown next to a recommendation entry's name when a champion pool is
 * active — mirrors the priority the server already baked into the sort
 * order, just so it's visible why one pick outranks another despite a
 * lower win rate. */
function TierBadge({ tier }: { tier?: 1 | 2 | 3 }) {
  if (!tier) return null;
  return <span className={`tier-badge tier-badge--${tier}`}>{tier}티어</span>;
}

/** Same "diff between early/late" threshold PowerCurveBadge already uses for
 * candidate recommendation rows, reused here so a laner and a candidate
 * label the same numbers the same way. */
function powerCurveLean(earlyWinRate: number | null, lateWinRate: number | null): string | null {
  if (earlyWinRate === null || lateWinRate === null) return null;
  const diff = lateWinRate - earlyWinRate;
  if (diff >= 0.03) return "후반형";
  if (diff <= -0.03) return "초반형";
  return "균형형";
}

const PHASE_LABELS = { early: "초반", mid: "중반", late: "후반" } as const;

/** Aggregates lol.ps power curves (early/mid/late win rate) across whatever
 * ally slots are filled in — see teamPowerCurve in the /api/pickadvice
 * response. Purely a display of real per-champion scraped numbers averaged
 * together; the "초반형/후반형/균형형" labels are the same fixed ±3%p
 * threshold PowerCurveBadge already uses elsewhere, not a new heuristic. */
function TeamPowerCurveCard({ curve }: { curve: TeamPowerCurve }) {
  if (curve.sampledCount === 0) {
    return (
      <p className="empty-hint">
        우리팀 라인에 채워진 챔피언들의 lol.ps 파워 커브 데이터를 찾지 못했습니다.
      </p>
    );
  }

  const phases: { key: "early" | "mid" | "late"; rate: number | null }[] = [
    { key: "early", rate: curve.teamEarlyWinRate },
    { key: "mid", rate: curve.teamMidWinRate },
    { key: "late", rate: curve.teamLateWinRate },
  ];
  const peak = phases.reduce<{ key: "early" | "mid" | "late"; rate: number } | null>((best, p) => {
    if (p.rate === null) return best;
    if (!best || p.rate > best.rate) return { key: p.key, rate: p.rate };
    return best;
  }, null);

  return (
    <div className="team-power-curve">
      {peak && (
        <p className="empty-hint">
          팀이 가장 강한 구간: <strong>{PHASE_LABELS[peak.key]}</strong> ({(peak.rate * 100).toFixed(1)}%)
        </p>
      )}
      <div className="team-power-curve-phases">
        {phases.map((p) => (
          <div
            key={p.key}
            className={`team-power-curve-phase${peak?.key === p.key ? " team-power-curve-phase--peak" : ""}`}
          >
            <span className="team-power-curve-phase-label">{PHASE_LABELS[p.key]}</span>
            <span className="team-power-curve-phase-rate">
              {p.rate !== null ? `${(p.rate * 100).toFixed(1)}%` : "데이터 없음"}
            </span>
          </div>
        ))}
      </div>
      <Details label="라이너별 상세">
        <p className="empty-hint">
          채워진 우리팀 {curve.sampledCount}명의 lol.ps 파워 커브(분당 승률)를 평균 낸 값입니다.
        </p>
        <ol className="recommend-list">
          {curve.laners.map((l) => {
            const lean = powerCurveLean(l.earlyWinRate, l.lateWinRate);
            return (
              <li key={l.position} className="recommend-row recommend-row--stacked">
                <div className="recommend-row-main">
                  <ChampionIcon src={l.champion.iconUrl} name={l.champion.name} />
                  <span className="recommend-name">
                    {POSITIONS.find((p) => p.value === l.position)?.label}: {l.champion.name}
                  </span>
                  {lean && <span className="power-curve-badge">{lean}</span>}
                </div>
                <p className="empty-hint">
                  초반 {l.earlyWinRate !== null ? `${(l.earlyWinRate * 100).toFixed(1)}%` : "-"} · 중반{" "}
                  {l.midWinRate !== null ? `${(l.midWinRate * 100).toFixed(1)}%` : "-"} · 후반{" "}
                  {l.lateWinRate !== null ? `${(l.lateWinRate * 100).toFixed(1)}%` : "-"}
                </p>
                {l.laneNote && <p className="build-lane-note">⚠ {l.laneNote}</p>}
                <PowerCurveDetails points={l.powerCurvePoints} />
              </li>
            );
          })}
        </ol>
      </Details>
    </div>
  );
}

/** "조합 비교" 탭의 파워 커브 카드 — TeamPowerCurveCard와 같은 성격(초반/
 * 중반/후반 평균+피크 구간, 라이너별 상세)이지만 포지션 개념이 없어서 라인
 * 불일치 캐비어트(laneNote)도 없다 — 각 챔피언 자신의 주 라인 커브를 그대로
 * 보여줄 뿐. */
function RosterPowerCurveCard({ title, curve }: { title: string; curve: RosterPowerCurve }) {
  if (curve.sampledCount === 0) {
    return <p className="empty-hint">{title}에 채워진 챔피언들의 lol.ps 파워 커브 데이터를 찾지 못했습니다.</p>;
  }

  const phases: { key: "early" | "mid" | "late"; rate: number | null }[] = [
    { key: "early", rate: curve.teamEarlyWinRate },
    { key: "mid", rate: curve.teamMidWinRate },
    { key: "late", rate: curve.teamLateWinRate },
  ];
  const peak = phases.reduce<{ key: "early" | "mid" | "late"; rate: number } | null>((best, p) => {
    if (p.rate === null) return best;
    if (!best || p.rate > best.rate) return { key: p.key, rate: p.rate };
    return best;
  }, null);

  return (
    <div className="team-power-curve">
      <h4>{title}</h4>
      {peak && (
        <p className="empty-hint">
          가장 강한 구간: <strong>{PHASE_LABELS[peak.key]}</strong> ({(peak.rate * 100).toFixed(1)}%)
        </p>
      )}
      <div className="team-power-curve-phases">
        {phases.map((p) => (
          <div
            key={p.key}
            className={`team-power-curve-phase${peak?.key === p.key ? " team-power-curve-phase--peak" : ""}`}
          >
            <span className="team-power-curve-phase-label">{PHASE_LABELS[p.key]}</span>
            <span className="team-power-curve-phase-rate">
              {p.rate !== null ? `${(p.rate * 100).toFixed(1)}%` : "데이터 없음"}
            </span>
          </div>
        ))}
      </div>
      <Details label="챔피언별 상세">
        <p className="empty-hint">{curve.sampledCount}명의 lol.ps 파워 커브(분당 승률)를 평균 낸 값입니다.</p>
        <ol className="recommend-list">
          {curve.perChampion.map((c) => {
            const lean = powerCurveLean(c.earlyWinRate, c.lateWinRate);
            return (
              <li key={c.id} className="recommend-row recommend-row--stacked">
                <div className="recommend-row-main">
                  <ChampionIcon src={c.iconUrl} name={c.name} />
                  <span className="recommend-name">{c.name}</span>
                  {lean && <span className="power-curve-badge">{lean}</span>}
                </div>
                <p className="empty-hint">
                  초반 {c.earlyWinRate !== null ? `${(c.earlyWinRate * 100).toFixed(1)}%` : "-"} · 중반{" "}
                  {c.midWinRate !== null ? `${(c.midWinRate * 100).toFixed(1)}%` : "-"} · 후반{" "}
                  {c.lateWinRate !== null ? `${(c.lateWinRate * 100).toFixed(1)}%` : "-"}
                </p>
                <PowerCurveDetails points={c.powerCurvePoints} />
              </li>
            );
          })}
        </ol>
      </Details>
    </div>
  );
}

const POOL_TIER_LABELS: Record<1 | 2 | 3, string> = {
  1: "1티어 (가장 숙련)",
  2: "2티어",
  3: "3티어",
};

/** Short form of POOL_TIER_LABELS for the "이미 다른 티어에 있음" badge —
 * "1티어 (가장 숙련)" would be too long to fit on a tiny grid tile badge. */
const POOL_TIER_SHORT_LABELS: Record<1 | 2 | 3, string> = { 1: "1티어", 2: "2티어", 3: "3티어" };

/** BuildCard's variantLabel for the i-th entry in a /api/build?variants=…
 * response — index 0 is always the source's single most-played build, so
 * this keeps the same "가장 인기 있는" wording BuildCard already defaults
 * to for the single-variant case, and only differentiates 2nd/3rd+. Falls
 * back to a generic ordinal for any index beyond what's named here (only
 * possible if MAX_VARIANTS on the server is ever raised past this list). */
const BUILD_VARIANT_LABELS = ["가장 인기 있는 빌드", "2번째로 인기 있는 빌드", "3번째로 인기 있는 빌드"];
function buildVariantLabel(index: number): string {
  return BUILD_VARIANT_LABELS[index] ?? `${index + 1}번째로 인기 있는 빌드`;
}

function ChampionPoolTier({
  tier,
  champions,
  championById,
  selectedIds,
  elsewhereLabels,
  isOpen,
  onToggleOpen,
  onToggleChampion,
}: {
  tier: 1 | 2 | 3;
  champions: ChampionSummary[];
  championById: Map<number, ChampionSummary>;
  selectedIds: number[];
  /** championId → "N티어" for champions already in a DIFFERENT tier of this
   * same position's pool — see ChampionPicker's own doc comment. */
  elsewhereLabels: Map<number, string>;
  isOpen: boolean;
  onToggleOpen: () => void;
  onToggleChampion: (championId: number) => void;
}) {
  return (
    <div className="pool-tier">
      <div className="pool-tier-header">
        <span className="pool-tier-label">{POOL_TIER_LABELS[tier]}</span>
        <button type="button" className="pool-tier-edit-btn" onClick={onToggleOpen}>
          {isOpen ? "닫기" : "+ 편집"}
        </button>
      </div>
      <div className="pool-chip-row">
        {selectedIds.length === 0 && <span className="empty-hint">챔피언 없음</span>}
        {selectedIds.map((id) => {
          const champ = championById.get(id);
          if (!champ) return null;
          return (
            <span key={id} className="pool-chip">
              <ChampionIcon src={champ.iconUrl} name={champ.name} className="pool-chip-icon" />
              {champ.name}
              <button
                type="button"
                className="pool-chip-remove"
                onClick={() => onToggleChampion(id)}
                aria-label={`${champ.name} 제거`}
              >
                ×
              </button>
            </span>
          );
        })}
      </div>
      {isOpen && (
        <ChampionPicker
          champions={champions}
          selectedIds={selectedIds}
          onToggle={onToggleChampion}
          maxSelect={Infinity}
          elsewhereLabels={elsewhereLabels}
        />
      )}
    </div>
  );
}

/** 픽 추천 전용: 사용자가 실제로 플레이하는 챔피언만, 지금 보고 있는
 * 포지션(`positionLabel`) 기준으로 1~3티어로 등록해두면 서버가 그 안에서만,
 * 그리고 티어 순서를 승률보다 우선해서 추천하도록 tier1/tier2/tier3 쿼리
 * 파라미터로 넘긴다. 아무것도 등록하지 않으면 지금까지처럼 전체 챔피언
 * 대상 추천으로 동작한다(EMPTY_TIER_BUCKET). `pool`은 이미 호출부에서
 * `championPool[position]`으로 뽑아온 "이 포지션만의" 티어 버킷 — 이
 * 컴포넌트 자체는 포지션 개념을 모르고 그냥 하나의 버킷만 다룬다. */
function ChampionPoolEditor({
  champions,
  championById,
  positionLabel,
  pool,
  poolApplied,
  onTogglePoolApplied,
  onToggleChampion,
}: {
  champions: ChampionSummary[];
  championById: Map<number, ChampionSummary>;
  positionLabel: string;
  pool: TierBucket;
  poolApplied: boolean;
  onTogglePoolApplied: (applied: boolean) => void;
  onToggleChampion: (tier: 1 | 2 | 3, championId: number) => void;
}) {
  const [openTier, setOpenTier] = useState<1 | 2 | 3 | null>(null);
  const total = pool[1].length + pool[2].length + pool[3].length;

  return (
    <div className="champion-pool-editor">
      {/* 적용/미적용 토글은 details 바깥(항상 보이는 위치)에 둠 — 원래
          details 안에 있어서 "내 챔피언 풀" 패널을 접으면(기본 상태) 같이
          숨겨졌는데, 패널을 펼치지 않고도 방금 등록해둔 풀을 껐다 켰다 할 수
          있어야 더 편리하다는 피드백을 반영함. */}
      {total > 0 && (
        <label className="pool-apply-toggle">
          <input
            type="checkbox"
            checked={poolApplied}
            onChange={(e) => onTogglePoolApplied(e.target.checked)}
          />
          챔피언 풀 적용 (끄면 풀은 그대로 두고 전체 챔피언 대상으로 추천)
        </label>
      )}
      <details>
        <summary>
          내 챔피언 풀 ({positionLabel}, 숙련도 우선순위)
          {total > 0 ? ` — ${total}명 설정됨${poolApplied ? "" : " (미적용)"}` : " — 설정 안 함 (전체 챔피언 대상)"}
        </summary>
        <p className="empty-hint">
          챔피언을 등록하면 아래 픽 추천이 이 안에서만 나오고, 1티어 → 2티어 → 3티어 순으로 우선 추천됩니다. 같은
          티어 안에서는 지금까지와 같은 승률 순위가 적용됩니다. 아무것도 등록하지 않으면 전체 챔피언을 대상으로
          추천합니다. <strong>포지션 탭을 바꾸면 그 포지션만의 풀을 따로 등록/조회합니다</strong> — 예를 들어 미드
          탭에서 등록한 챔피언은 탑 추천엔 나오지 않습니다.
        </p>
        {([1, 2, 3] as const).map((tier) => {
          // 이 티어가 아닌 다른 두 티어에 이미 들어있는 챔피언 → "N티어"
          // 배지로 표시(ChampionPicker의 elsewhereLabels). toggleChampionInPool
          // 이 한 챔피언을 항상 최대 한 티어에만 두도록 보장하므로(다른
          // 티어에서 빼고 이 티어에 넣음), 한 챔피언이 여기서 두 번 이상
          // 매치될 일은 없음.
          const elsewhereLabels = new Map<number, string>();
          for (const otherTier of [1, 2, 3] as const) {
            if (otherTier === tier) continue;
            for (const id of pool[otherTier]) elsewhereLabels.set(id, POOL_TIER_SHORT_LABELS[otherTier]);
          }
          return (
            <ChampionPoolTier
              key={tier}
              tier={tier}
              champions={champions}
              championById={championById}
              selectedIds={pool[tier]}
              elsewhereLabels={elsewhereLabels}
              isOpen={openTier === tier}
              onToggleOpen={() => setOpenTier((cur) => (cur === tier ? null : tier))}
              onToggleChampion={(championId) => onToggleChampion(tier, championId)}
            />
          );
        })}
      </details>
    </div>
  );
}

function SourceStatusNote({
  succeeded,
  attempted,
  errors,
}: {
  succeeded: number;
  attempted: number;
  errors: SourceErrorInfo[];
}) {
  if (errors.length === 0) return null;
  return (
    <details className="source-status">
      <summary>
        {attempted}개 소스 중 {succeeded}개 성공 ({errors.length}개 실패 — 눌러서 자세히 보기)
      </summary>
      <ul>
        {errors.map((e) => (
          <li key={e.sourceId}>
            <strong>{e.sourceLabel}</strong>: {e.message}
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Real LoL inventory has 6 item slots (boots included) plus a separate
 * trinket slot — this tab only models the 6 item slots since trinkets carry
 * no meaningful stats/price to aggregate. */
const ITEM_SLOT_COUNT = 6;

export default function Home() {
  const [champions, setChampions] = useState<ChampionSummary[]>([]);
  const [champLoadError, setChampLoadError] = useState<string | null>(null);
  /** "아이템 빌드" 탭 전용 데이터/상태 — 챔피언 슬롯(slots/activeSlotKey/
   * pickerOpen) 머신과는 완전히 독립적으로 둔다. 챔피언 기반 4개 탭이 이미
   * 그 상태를 픽 추천의 10슬롯/조합 비교의 5+5슬롯 등 서로 다른 방식으로
   * 재사용하고 있어서, 성격이 전혀 다른(포지션도 팀도 없는 6슬롯 아이템
   * 목록) 이 탭까지 같은 상태에 끼워 넣으면 그 로직들이 더 얽히기 쉽다. */
  const [items, setItems] = useState<ItemSummary[]>([]);
  const [itemLoadError, setItemLoadError] = useState<string | null>(null);
  const [itemSlots, setItemSlots] = useState<(number | null)[]>(Array(ITEM_SLOT_COUNT).fill(null));
  const [activeItemSlotIndex, setActiveItemSlotIndex] = useState<number | null>(null);
  const [itemPickerOpen, setItemPickerOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("counter");
  const [position, setPosition] = useState("top");
  const [slots, setSlots] = useState<Slot[]>([{ key: "target", label: "기준 챔피언", championId: null }]);
  const [activeSlotKey, setActiveSlotKey] = useState("target");
  /** Whether the champion picker is showing as a full-screen overlay — see
   * activateSlot below. Shared by all three modes (counter/build/advice) so
   * tapping any slot always opens the same full-screen picker. */
  const [pickerOpen, setPickerOpen] = useState(false);
  /** The champion most recently placed into a slot — drives the big
   * portrait preview in advice mode's champ-select layout. Not tied to
   * activeSlotKey because assignActiveSlot immediately advances that to the
   * NEXT empty slot, which would otherwise flip the portrait back to empty
   * right after every pick. */
  const [lastPickedChampionId, setLastPickedChampionId] = useState<number | null>(null);
  const [counterResult, setCounterResult] = useState<CounterResult | null>(null);
  /** True once a 라인 카운터 lookup has completed and every one of the 6
   * sites failed (the only case /api/counters returns a non-ok response) —
   * distinct from counterResult itself being null before any lookup has run
   * yet. Drives a fallback hint so a total-failure lookup doesn't just leave
   * the results section silently missing (see runLookup's counter branch). */
  const [counterLookupFailed, setCounterLookupFailed] = useState(false);
  const [adviceResult, setAdviceResult] = useState<AdviceResult | null>(null);
  const [compareResult, setCompareResult] = useState<CompCompareResult | null>(null);
  /** lol.ps's build(s) for this champion+position — always 0 or 1 entries,
   * since lol.ps only ever tracks a single build per champion (no ranked
   * variant list the way deeplol has). Kept as an array (not a bare
   * BuildResult | null) so the render can map both sources the same way. */
  const [buildResultsLolps, setBuildResultsLolps] = useState<BuildResult[]>([]);
  /** DeepLoL's ranked build variants (up to 3) for the same champion+
   * position — fetched alongside buildResultsLolps as separately-labeled
   * cards. The two sources are mutually best-effort (fetched concurrently
   * via Promise.allSettled in runLookup) — either one failing never blocks
   * the other from showing. See /api/build's `variants` param and
   * getChampionBuildVariants (src/lib/sources/deeplol.ts). */
  const [buildResultsDeeplol, setBuildResultsDeeplol] = useState<BuildResult[]>([]);
  /** Whether a 빌드 tab lookup has actually completed at least once — lets
   * the render distinguish "haven't queried yet" (show nothing) from
   * "queried and both sources came back empty" (show a hint instead of a
   * silently blank page — see runLookup's build branch). */
  const [buildLookupAttempted, setBuildLookupAttempted] = useState(false);
  /** Build recommendation auto-fetched alongside 라인 카운터's own result, for
   * the same champion+position — separate from buildResultsLolps (the dedicated
   * 빌드 tab's own fetch) so switching modes doesn't clobber either. */
  const [counterBuild, setCounterBuild] = useState<BuildResult | null>(null);
  const [loading, setLoading] = useState(false);
  /** Bumped once per runLookup() call — lets an in-flight request tell,
   * once its fetch resolves, whether a newer request has since started
   * (see isStale() inside runLookup) so a slow response can never clobber
   * a more recent one now that 픽 추천 auto-fetches on every slot edit. */
  const requestIdRef = useRef(0);
  const [championPool, setChampionPool] = useState<ChampionPool>(EMPTY_POOL);
  const [poolLoaded, setPoolLoaded] = useState(false);
  /** Whether the champion pool (if any is set) actually restricts 픽 추천's
   * recommendation lists — separate from the pool itself so the user can
   * flip this off to see unrestricted recommendations without having to
   * clear out their saved pool first. No-op when the pool is empty either
   * way. Not persisted (see RecommendCount above for why). */
  const [poolApplied, setPoolApplied] = useState(true);
  /** How many entries 픽 추천's recommendation lists show — see
   * RecommendCount above. */
  const [recommendCount, setRecommendCount] = useState<RecommendCount>(5);
  useEffect(() => {
    fetch("/api/champions")
      .then((res) => res.json())
      .then((data) => setChampions(data.champions))
      .catch(() => setChampLoadError("챔피언 목록을 불러오지 못했습니다."));
  }, []);

  useEffect(() => {
    fetch("/api/items")
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        // /api/items now has no fallback source (Community Dragon only —
        // "모든 데이터를 제시한 링크에서만 가져와줘") and returns a 502
        // with { error } on total failure instead of an empty catalog, so
        // this has to check res.ok rather than always trusting data.items.
        if (ok) {
          setItems(data.items);
        } else {
          setItemLoadError(typeof data.error === "string" ? data.error : "아이템 목록을 불러오지 못했습니다.");
        }
      })
      .catch(() => setItemLoadError("아이템 목록을 불러오지 못했습니다."));
  }, []);

  // localStorage read must happen after mount (SSR has no window) — this
  // deliberately runs once, before the write-back effect below is armed via
  // poolLoaded, so an empty initial state never overwrites a saved pool.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(POOL_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const next: ChampionPool = { ...EMPTY_POOL };
        for (const p of POSITIONS) {
          const bucket = parsed?.[p.value];
          if (isValidTierBucket(bucket)) {
            next[p.value] = {
              1: bucket[1].filter((id) => typeof id === "number"),
              2: bucket[2].filter((id) => typeof id === "number"),
              3: bucket[3].filter((id) => typeof id === "number"),
            };
          }
          // else: missing/invalid for this position (including every
          // position, for the old pre-per-position storage shape — see
          // isValidTierBucket) — leave it at EMPTY_POOL's empty bucket.
        }
        // Must run after mount (SSR has no localStorage); reading it any
        // earlier would make the server/client hydration render disagree.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setChampionPool(next);
      }
    } catch {
      // corrupt or unavailable storage — keep the default empty pool
    }
    setPoolLoaded(true);
  }, []);

  useEffect(() => {
    if (!poolLoaded) return;
    try {
      localStorage.setItem(POOL_STORAGE_KEY, JSON.stringify(championPool));
    } catch {
      // storage unavailable (private browsing, quota) — pool just won't persist
    }
  }, [championPool, poolLoaded]);

  /** Toggles championId in/out of the given tier, scoped to ONE position's
   * bucket — every other position's bucket keeps the exact same object
   * reference (see the ChampionPool doc comment above), so effects/renders
   * depending on just `championPool[position]` don't re-fire when a
   * different position's pool changes. */
  function toggleChampionInPool(pos: Position, tier: 1 | 2 | 3, championId: number) {
    setChampionPool((prev) => {
      const posPool = prev[pos];
      const inThisTier = posPool[tier].includes(championId);
      const nextPosPool: TierBucket = {
        1: posPool[1].filter((id) => id !== championId),
        2: posPool[2].filter((id) => id !== championId),
        3: posPool[3].filter((id) => id !== championId),
      };
      if (!inThisTier) nextPosPool[tier] = [...nextPosPool[tier], championId];
      return { ...prev, [pos]: nextPosPool };
    });
  }

  const championById = useMemo(() => {
    const map = new Map<number, ChampionSummary>();
    for (const c of champions) map.set(c.id, c);
    return map;
  }, [champions]);

  const portraitChampion = lastPickedChampionId !== null ? (championById.get(lastPickedChampionId) ?? null) : null;

  function switchMode(next: Mode) {
    setMode(next);
    setCounterResult(null);
    setCounterLookupFailed(false);
    setAdviceResult(null);
    setCompareResult(null);
    setLastPickedChampionId(null);
    setBuildResultsLolps([]);
    setBuildResultsDeeplol([]);
    setBuildLookupAttempted(false);
    setCounterBuild(null);
    setPickerOpen(false);
    setItemSlots(Array(ITEM_SLOT_COUNT).fill(null));
    setActiveItemSlotIndex(null);
    setItemPickerOpen(false);
    if (next === "counter" || next === "build") {
      const nextSlots: Slot[] = [{ key: "target", label: "기준 챔피언", championId: null }];
      setSlots(nextSlots);
      setActiveSlotKey(nextSlots[0].key);
    } else if (next === "compcompare") {
      const nextSlots = compCompareSlotsFor();
      setSlots(nextSlots);
      setActiveSlotKey(nextSlots[0].key);
    } else if (next === "itembuild") {
      // 이 탭은 챔피언 슬롯(slots/activeSlotKey)을 아예 안 씀 — 건드리지 않음.
    } else {
      const nextSlots = adviceSlotsFor();
      setSlots(nextSlots);
      setActiveSlotKey(`enemy-${position}`);
    }
  }

  /** Position tabs are shared by counter mode and advice mode. In advice
   * mode, changing position just moves which ally slot counts as "내 픽" for
   * labeling purposes and which enemy slot the recommendation is keyed off
   * of — every slot's own value is left untouched (all 10 are equally
   * fillable now, see adviceSlotsFor's doc comment), so switching position
   * tabs back and forth never loses anything you've already filled in. */
  function changePosition(next: string) {
    setPosition(next);
    if (mode === "advice") {
      setActiveSlotKey(`enemy-${next}`);
      setAdviceResult(null);
    } else if (mode === "compcompare") {
      // "조합 비교" 탭의 포지션은 슬롯/활성 슬롯과는 무관 — likelyEnemyLaners가
      // 이 값 기준으로 다시 계산돼야 하므로 이전 결과만 비움(아래 자동조회
      // useEffect가 slots와 함께 position도 의존성으로 갖고 있어 바뀌면 다시
      // 조회함).
      setCompareResult(null);
    }
  }

  // "다음 빈 슬롯이 있는지"는 setSlots의 state 업데이터 함수 안이 아니라
  // 여기서 클로저의 현재 slots 값으로 미리 판단한다 — setState 업데이터가
  // 이 함수 안 나머지 코드보다 먼저(동기적으로) 실행된다는 보장이 없어서,
  // 그 안에서 계산한 값을 곧바로 밖에서 읽으면 실제로는 매번 갱신 전 값을
  // 보게 되는 버그가 날 수 있다.
  function assignActiveSlot(championId: number) {
    setLastPickedChampionId(championId);
    const nextEmpty = slots.find((s) => s.key !== activeSlotKey && s.championId === null);
    setSlots((prev) => prev.map((s) => (s.key === activeSlotKey ? { ...s, championId } : s)));
    if (nextEmpty) setActiveSlotKey(nextEmpty.key);
    // "조합 비교" 탭만 선택 창을 열어둔 채로 다음 빈 슬롯으로 바로 넘어감
    // (실제 드래프트 타이머에 맞춰 여러 명을 빠르게 입력해야 한다는 요청으로
    // 추가 — ChampionPicker의 quickInput 참고). 라인 카운터/빌드/픽 추천은
    // 기존처럼 픽할 때마다 선택 창이 항상 닫힘.
    if (mode !== "compcompare" || !nextEmpty) {
      setPickerOpen(false);
    }
  }

  /** Sets the active slot and opens the full-screen champion picker for it —
   * use this instead of setActiveSlotKey directly for any real user tap on a
   * slot, in all three modes (counter/build/advice). It closes again once a
   * pick is made (assignActiveSlot above) or via the overlay's own close
   * button. Deliberately not used for auto-advance to the next empty slot in
   * assignActiveSlot (advice mode's 10-slot board) or for mode switches — in
   * both of those the user is already looking at (or just left) the picker,
   * so re-opening it there would just be jarring motion for no reason. */
  function activateSlot(key: string) {
    setActiveSlotKey(key);
    setPickerOpen(true);
  }

  function clearSlot(key: string) {
    setSlots((prev) => prev.map((s) => (s.key === key ? { ...s, championId: null } : s)));
    activateSlot(key);
  }

  /** Empties the slot the picker is currently open for and closes it —
   * exposed as an explicit "빈 슬롯으로 두기" button in the picker overlay
   * header (see below) so leaving a slot blank is a clearly labeled action,
   * not just an implicit side effect of pressing ✕ without picking anything
   * (which happened to produce the same result, since clicking a filled slot
   * already blanks it via clearSlot before the picker even opens — but that
   * was never an obvious/intentional-looking way to clear a pick). Safe to
   * call even when the slot is already empty (e.g. opened via activateSlot
   * on an empty slot, changed your mind) — same no-op outcome either way. */
  function blankActiveSlot() {
    setSlots((prev) => prev.map((s) => (s.key === activeSlotKey ? { ...s, championId: null } : s)));
    setPickerOpen(false);
  }

  /** "아이템 빌드" 탭의 슬롯 조작 — 위 챔피언 슬롯 함수들과 같은 모양
   * (activate로 열기, assign으로 채우고 닫기, blank로 비우고 닫기)이지만
   * itemSlots(단순 6칸 배열, 포지션/팀 개념 없음)에 대해서만 동작한다. */
  function activateItemSlot(index: number) {
    setActiveItemSlotIndex(index);
    setItemPickerOpen(true);
  }

  function clearItemSlot(index: number) {
    setItemSlots((prev) => prev.map((id, i) => (i === index ? null : id)));
    activateItemSlot(index);
  }

  function assignActiveItemSlot(itemId: number) {
    if (activeItemSlotIndex === null) return;
    const index = activeItemSlotIndex;
    setItemSlots((prev) => prev.map((id, i) => (i === index ? itemId : id)));
    setItemPickerOpen(false);
  }

  function blankActiveItemSlot() {
    if (activeItemSlotIndex === null) return;
    const index = activeItemSlotIndex;
    setItemSlots((prev) => prev.map((id, i) => (i === index ? null : id)));
    setItemPickerOpen(false);
  }

  const itemById = useMemo(() => new Map(items.map((it) => [it.id, it])), [items]);

  const filledBuildItems = useMemo(
    () => itemSlots.map((id) => (id !== null ? (itemById.get(id) ?? null) : null)).filter((it): it is ItemSummary => it !== null),
    [itemSlots, itemById],
  );

  const itemBuildTotalCost = filledBuildItems.reduce((sum, it) => sum + it.cost.total, 0);

  /** 채워진 아이템들의 스탯을 키별로 그대로 더한 합계 — 아이템마다 서로
   * 다른 스탯 키를 가질 수 있어서 Map으로 모으고, 같은 키가 여러 아이템에
   * 걸쳐 나오면(예: 방어구템 두 개 다 FlatArmorMod를 가짐) 그 값들을 그대로
   * 더한다. 퍼센트 스탯(예: 공격 속도)도 마찬가지로 소수 그대로 더하고
   * 표시할 때만 formatStatValue가 %로 바꾼다 — 게임 내 실제 공식(감소
   * 체감 등)은 반영하지 않는 단순 합산이라는 점을 화면에도 명시한다. */
  const itemBuildStatTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const it of filledBuildItems) {
      for (const [key, value] of Object.entries(it.stats)) {
        totals.set(key, (totals.get(key) ?? 0) + value);
      }
    }
    return totals;
  }, [filledBuildItems]);

  // Every champion currently placed in any slot (not just the active one) —
  // shows a checkmark on its tile in the picker grid. Previously this only
  // looked at the active slot's own championId, but assignActiveSlot
  // immediately auto-advances to the next empty slot right after a pick, so
  // that slot's championId is null again by the time the picker re-renders
  // — in practice the checkmark almost never showed. Scoping this to "any
  // filled slot" instead makes it show reliably, and is more useful anyway
  // (glance at the grid, see everyone you've already placed on the board).
  const pickerSelectedIds = slots.map((s) => s.championId).filter((id): id is number => id !== null);

  // Which slot the full-screen picker is currently filling — drives its
  // header title (e.g. "기준 챔피언 선택" in counter/build mode, "우리팀 미드
  // 선택" in advice mode).
  const activeSlot = slots.find((s) => s.key === activeSlotKey);

  // Lock background scroll while the full-screen picker overlay is open —
  // otherwise a touch-drag on the grid can also scroll the (hidden-behind-it)
  // page underneath on some mobile browsers.
  useEffect(() => {
    if (!pickerOpen) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, [pickerOpen]);

  const canRun =
    mode === "counter" || mode === "build" ? slots[0]?.championId !== null : slots.some((s) => s.championId !== null);

  async function runLookup() {
    // 챔피언을 하나씩 입력할 때마다 자동으로 재조회하다 보니(아래
    // auto-fetch useEffect), 느린 이전 요청의 응답이 더 최신 상태에 대한
    // 요청보다 늦게 도착해서 최신 결과를 덮어쓸 수 있음 — 이 요청이
    // "아직도 최신 요청인지"를 매번 확인해서, 그 사이 새 요청이 시작됐으면
    // 응답이 와도 화면에 반영하지 않고 조용히 버림.
    const requestId = ++requestIdRef.current;
    const isStale = () => requestId !== requestIdRef.current;
    setLoading(true);
    try {
      if (mode === "counter") {
        const championId = slots[0].championId;
        const res = await fetch(`/api/counters?championId=${championId}&position=${position}`);
        const data = await res.json();
        if (isStale()) return;
        if (!res.ok) {
          // 6개 소스가 전부 실패했을 때(getAggregatedLaneCounters가 던지는
          // 유일한 경우) — 예전엔 여기서 그냥 throw해서 바깥 catch가 조용히
          // console.error만 하고 끝나, 결과 섹션 자체가 아예 안 뜨는 채로
          // 남아 사용자 입장에선 "조회했는데 화면에 아무것도 안 나옴"으로만
          // 보였음. counterResult를 명시적으로 비우고 counterLookupFailed를
          // 켜서 아래 렌더링에서 안내 문구라도 보여주도록 고침.
          console.error(data.error ?? "조회에 실패했습니다.");
          setCounterResult(null);
          setCounterLookupFailed(true);
          return;
        }
        setCounterLookupFailed(false);
        setCounterResult(data);
        setCounterBuild(null);
        fetch(`/api/build?championId=${championId}&position=${position}`)
          .then((r) => r.json().then((d) => ({ ok: r.ok, data: d })))
          .then(({ ok, data: buildData }) => {
            if (ok && !isStale()) setCounterBuild(buildData);
          })
          .catch(() => {
            // Best-effort — 라인 카운터 결과 자체는 이미 떴으니 조용히 무시.
          });
      } else if (mode === "build") {
        // lol.ps와 DeepLoL을 서로 독립적인 best-effort 소스로 취급 — 예전엔
        // lol.ps(source=lolps)를 먼저 fetch해서 실패하면 즉시 throw하고
        // DeepLoL은 시도조차 안 했음(아래 두 번째 fetch가 그 뒤에 있어서
        // throw가 나면 실행되지 않음). 그래서 lol.ps 쪽만 일시적으로 막히거나
        // (사이트 구조 변경, 레이트 리밋 등) 실패해도 DeepLoL 데이터가 멀쩡히
        // 있는데도 빌드 탭 전체가 빈 화면으로 보였음. Promise.allSettled로
        // 두 요청을 동시에 시작하고 각자 독립적으로 성공/실패를 반영해서,
        // 한쪽만 살아있어도 그 카드는 뜨도록 고침 — 픽 추천 API가
        // annotateWithBuild/annotateWithDeeplolBuild를 이미 같은 방식(둘 다
        // best-effort, Promise.all로 동시 실행)으로 다루는 것과 같은 원칙.
        const championId = slots[0].championId;
        // variants=3 asks for up to 3 ranked build variants per source (see
        // /api/build's `variants` param) — lol.ps only ever has one, so its
        // `builds` array comes back as 0 or 1 entries either way, but this
        // keeps both fetches going through the same { builds: [...] }
        // response shape instead of special-casing each source's parsing.
        const fetchBuilds = (source: "lolps" | "deeplol") =>
          fetch(`/api/build?championId=${championId}&position=${position}&source=${source}&variants=3`).then((r) =>
            r.json().then((d) => ({ ok: r.ok, data: d as { builds: BuildResult[] } })),
          );
        const [lolpsResult, deeplolResult] = await Promise.allSettled([
          fetchBuilds("lolps"),
          fetchBuilds("deeplol"),
        ]);
        if (isStale()) return;
        setBuildResultsLolps(
          lolpsResult.status === "fulfilled" && lolpsResult.value.ok ? lolpsResult.value.data.builds : [],
        );
        setBuildResultsDeeplol(
          deeplolResult.status === "fulfilled" && deeplolResult.value.ok ? deeplolResult.value.data.builds : [],
        );
        setBuildLookupAttempted(true);
      } else if (mode === "compcompare") {
        const allyIds = slots
          .filter((s) => s.key.startsWith("compally-"))
          .map((s) => s.championId)
          .filter((id): id is number => id !== null);
        const enemyIds = slots
          .filter((s) => s.key.startsWith("compenemy-"))
          .map((s) => s.championId)
          .filter((id): id is number => id !== null);
        const params = new URLSearchParams();
        if (allyIds.length > 0) params.set("ally", allyIds.join(","));
        if (enemyIds.length > 0) params.set("enemy", enemyIds.join(","));
        // "내 맞 라이너일 확률이 높은 3명" 계산에 필요 — 없으면 서버가
        // likelyEnemyLaners를 그냥 빈 배열로 돌려줌(요청 실패는 아님).
        params.set("position", position);
        const res = await fetch(`/api/compcompare?${params.toString()}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "조회에 실패했습니다.");
        if (isStale()) return;
        setCompareResult(data);
      } else {
        const params = new URLSearchParams({ position, count: String(recommendCount) });
        for (const slot of slots) {
          if (slot.championId !== null) params.set(slot.key, String(slot.championId));
        }
        if (poolApplied) {
          // 지금 보고 있는 포지션(position)의 풀만 보냄 — 다른 포지션에
          // 등록해둔 챔피언은 이 요청에 영향을 주지 않음(ChampionPool 타입
          // 선언부 주석 참고).
          const posPool = championPool[position as Position];
          if (posPool[1].length > 0) params.set("tier1", posPool[1].join(","));
          if (posPool[2].length > 0) params.set("tier2", posPool[2].join(","));
          if (posPool[3].length > 0) params.set("tier3", posPool[3].join(","));
        }
        const res = await fetch(`/api/pickadvice?${params.toString()}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "조회에 실패했습니다.");
        if (isStale()) return;
        setAdviceResult(data);
      }
    } catch (e) {
      // 사용자에게는 에러 메시지를 보여주지 않음 — 조회에 실패하면 해당
      // 결과 영역이 그냥 비어있는 채로 남음(각 setXxxResult가 호출되지
      // 않으므로). 콘솔에는 남겨서 devtools로는 원인을 볼 수 있게 함.
      console.error(e);
    } finally {
      if (isStale()) return;
      setLoading(false);
    }
  }

  /** 픽 추천은 "픽 추천 받기" 버튼을 눌러야만 조회되던 걸 버리고, 챔피언을
   * 한 명씩 슬롯에 넣을 때마다(또는 지울 때, 포지션을 바꿀 때, 챔피언 풀을
   * 바꿀 때) 자동으로 다시 조회하도록 함 — canRun이 이미 "슬롯 하나라도
   * 채워지면 true"라서 그 조건을 그대로 재사용. 빠르게 여러 슬롯을 연달아
   * 클릭할 때마다 6개 사이트를 매번 스크래핑하는 걸 막기 위해 마지막
   * 변경 이후 500ms 동안 조용하면 그때 한 번만 실행(디바운스) — 그 사이
   * 또 슬롯이 바뀌면 이전 타이머는 취소되고 다시 500ms를 기다림. 버튼은
   * 그대로 남겨뒀으니 디바운스를 기다리지 않고 바로 조회하고 싶으면 눌러도
   * 됨. canRun이 false면(챔피언이 하나도 없으면) 아예 조회하지 않고,
   * 화면에서도 이전 추천 결과를 숨김(아래 렌더링 쪽 canRun 체크 참고 —
   * 상태를 여기서 지우는 대신 렌더링 시점에만 숨겨서 이펙트 안에서
   * setState를 안 부르도록 함). 다른 3개 모드(카운터/듀오/빌드)는 여기
   * 대상이 아니라 지금처럼 버튼을 눌러야 조회됨 — 필요하면 알려주세요.
   * poolApplied/recommendCount도 championPool[position]과 같은 이유로
   * 의존성에 포함 — 셋 다 바뀌면 서버로 보내는 쿼리 파라미터가 달라지므로
   * 재조회가 필요함. championPool 전체가 아니라 championPool[position]만
   * 의존성으로 둔 것은 의도적 — 지금 안 보고 있는 다른 포지션의 풀을
   * 편집해도(toggleChampionInPool이 그 포지션의 객체만 바꾸므로) 이 값의
   * 참조가 그대로라 불필요한 재조회가 안 일어남.
   *
   * "조합 비교" 탭도 같은 자동조회+디바운스를 그대로 씀 — position/
   * championPool[position]/poolApplied/recommendCount는 이 탭에서 안 바뀌는
   * 값이라(그 UI 자체가 이 탭엔 없음) 그냥 두어도 불필요한 재조회를
   * 일으키지 않는다. */
  useEffect(() => {
    if ((mode !== "advice" && mode !== "compcompare") || !canRun) return;
    const timeout = setTimeout(() => {
      runLookup();
    }, 500);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, canRun, slots, position, championPool[position as Position], poolApplied, recommendCount]);

  function renderSlot(slot: Slot) {
    const champ = slot.championId !== null ? championById.get(slot.championId) : null;
    const active = slot.key === activeSlotKey;
    return (
      <button
        key={slot.key}
        type="button"
        className={`slot${active ? " slot--active" : ""}${champ ? "" : " slot--empty"}`}
        onClick={() => (champ ? clearSlot(slot.key) : activateSlot(slot.key))}
      >
        {champ ? (
          <>
            <ChampionIcon src={champ.iconUrl} name={champ.name} />
            <span>{champ.name}</span>
          </>
        ) : (
          <span>{slot.label} 선택</span>
        )}
      </button>
    );
  }

  /** Which of the four CC-dot states (yes/soft/no/unknown) a slot's champion
   * falls into, plus its tooltip — factored out of renderChampSelectSlot so
   * the yes/soft priority order (hard CC wins even when a champion also has
   * a slow) lives in exactly one place. */
  function ccDotState(entry: ChampionCCInfo | undefined): { kind: "yes" | "soft" | "no" | "unknown"; title: string } {
    if (entry === undefined) return { kind: "unknown", title: "CC 정보 확인 중" };
    if (entry.hasHardCC) return { kind: "yes", title: "하드 CC 보유 (기절/속박/공포/도발 등)" };
    if (entry.hasSoftCC) return { kind: "soft", title: "일반 CC만 보유 (둔화)" };
    return { kind: "no", title: "CC 없음" };
  }

  /** advice mode's champ-select-style slot — same select/clear behavior as
   * renderSlot, just laid out to sit in a narrow vertical team column (role
   * tag + icon + name in one row) instead of a horizontal pill row. */
  function renderChampSelectSlot(slot: Slot, side: "ally" | "enemy") {
    const shortLabel = POSITION_SHORT_LABEL[slot.key.replace(`${side}-`, "")] ?? "";
    // 내 포지션(위 포지션 탭에서 고른 값)에 해당하는 우리팀 슬롯 — 예전엔
    // 이 슬롯만 항상 잠겨있어서("추천 대상 자리", 채울 수 없음) 정작 내가
    // 여기 뭘 넣었을 때 조합이 어떻게 보이는지 확인할 방법이 없었음. 이제는
    // 다른 슬롯과 똑같이 채울 수 있고, 이 배지로 "이게 내 포지션 슬롯"이라는
    // 것만 표시함 — 픽 추천 순위 계산은 이 슬롯이 아니라 enemy 슬롯(맞
    // 라이너) 기준이라 채워도 추천 자체는 그대로 계속 나옴.
    const isMine = side === "ally" && slot.key === `ally-${position}`;
    const champ = slot.championId !== null ? championById.get(slot.championId) : null;
    const active = slot.key === activeSlotKey;
    // undefined = 아직 조회 안 됨/실패(회색 물음표) — 그 외엔 championSkills.ts/
    // ccInfo API 응답의 hasHardCC/hasSoftCC 값 그대로(조합 컨셉/픽 추천 순위
    // 보정에 이미 쓰던 것과 같은 데이터를 챔피언 선택 화면에도 그대로 노출).
    // 하드 CC(기절/속박/공포/도발 등, 완전히 무력화)와 일반 CC(둔화만 있는
    // 경우)를 점 색으로 구분 — 아래 ccDotState 참고.
    const ccEntry = champ ? adviceResult?.ccInfo[side]?.find((c) => c.championId === champ.id) : undefined;
    const ccDot = ccDotState(ccEntry);
    return (
      <button
        key={slot.key}
        type="button"
        className={`champ-select-slot${active ? " champ-select-slot--active" : ""}${champ ? "" : " champ-select-slot--empty"}${isMine ? " champ-select-slot--mine" : ""}`}
        onClick={() => (champ ? clearSlot(slot.key) : activateSlot(slot.key))}
      >
        <span className="champ-select-role">{shortLabel}</span>
        {isMine && <span className="champ-select-mine-badge">내 픽</span>}
        {champ ? (
          <>
            <ChampionIcon src={champ.iconUrl} name={champ.name} />
            <span>{champ.name}</span>
            <span className={`champ-select-cc-dot champ-select-cc-dot--${ccDot.kind}`} title={ccDot.title} />
          </>
        ) : (
          <span className="empty-hint">선택</span>
        )}
      </button>
    );
  }

  /** "조합 비교" 탭의 슬롯 — renderChampSelectSlot과 같은 시각 스타일
   * (.champ-select-slot 재사용)이지만 포지션 역할 라벨/"내 픽" 배지가 없다
   * (이 탭엔 포지션 개념 자체가 없음). CC 점은 adviceResult가 아니라
   * compareResult의 해당 로스터 ccInfo에서 가져온다. */
  function renderCompCompareSlot(slot: Slot, side: "ally" | "enemy") {
    const champ = slot.championId !== null ? championById.get(slot.championId) : null;
    const active = slot.key === activeSlotKey;
    const roster = side === "ally" ? compareResult?.ally : compareResult?.enemy;
    const ccEntry = champ ? roster?.ccInfo.find((c) => c.championId === champ.id) : undefined;
    const ccDot = ccDotState(ccEntry);
    return (
      <button
        key={slot.key}
        type="button"
        className={`champ-select-slot${active ? " champ-select-slot--active" : ""}${champ ? "" : " champ-select-slot--empty"}`}
        onClick={() => (champ ? clearSlot(slot.key) : activateSlot(slot.key))}
      >
        {champ ? (
          <>
            <ChampionIcon src={champ.iconUrl} name={champ.name} />
            <span>{champ.name}</span>
            <span className={`champ-select-cc-dot champ-select-cc-dot--${ccDot.kind}`} title={ccDot.title} />
          </>
        ) : (
          <span className="empty-hint">선택</span>
        )}
      </button>
    );
  }

  return (
    <main className="page">
      <header className="page-header">
        <h1>
          GGOBIS <span className="page-header-kr">꼬비스</span>
        </h1>
        <p>op.gg, u.gg, lolalytics 등 여러 사이트의 실제 통계를 요청할 때마다 실시간으로 가져와 보여줍니다 (자체 DB 없음).</p>
      </header>

      <div className="mode-tabs">
        <button
          type="button"
          className={mode === "counter" ? "tab tab--active" : "tab"}
          onClick={() => switchMode("counter")}
        >
          라인 카운터
        </button>
        <button
          type="button"
          className={mode === "advice" ? "tab tab--active" : "tab"}
          onClick={() => switchMode("advice")}
        >
          픽 추천
        </button>
        <button
          type="button"
          className={mode === "build" ? "tab tab--active" : "tab"}
          onClick={() => switchMode("build")}
        >
          빌드
        </button>
        <button
          type="button"
          className={mode === "compcompare" ? "tab tab--active" : "tab"}
          onClick={() => switchMode("compcompare")}
        >
          조합 비교
        </button>
        <button
          type="button"
          className={mode === "itembuild" ? "tab tab--active" : "tab"}
          onClick={() => switchMode("itembuild")}
        >
          아이템 빌드
        </button>
      </div>

      {mode !== "itembuild" && (
        <div className="position-tabs">
          {POSITIONS.map((p) => (
            <button
              key={p.value}
              type="button"
              className={position === p.value ? "tab tab--active" : "tab"}
              onClick={() => changePosition(p.value)}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      {mode === "compcompare" && (
        <p className="empty-hint">
          위 포지션은 <strong>내가 픽할 포지션</strong>을 뜻해요 — 상대팀 5명 중 이 포지션 표본이 가장 많은
          (=내 맞 라이너일 확률이 높은) 최대 3명을 추려서, 각각에 대한 카운터 픽 추천을 아래에 보여드려요.
        </p>
      )}

      {mode === "advice" && (
        <Details label="픽 추천 사용법">
          <p className="empty-hint">
            우리팀/상대팀 각 라인에 이미 정해진 챔피언이 있으면 채워보세요. <strong>내 픽 추천</strong>의 실제
            승률은
            <strong> 상대 {POSITIONS.find((p) => p.value === position)?.label} 라이너</strong>
            {position === "support" && (
              <>
                {" "}
                와 <strong>우리팀 원거리 딜러</strong>
              </>
            )}
            와의 매치업에서만 가져와요(사이트에 다른 포지션 상대와의 실측 데이터는 없어요). 대신 순위를 매길 때는{" "}
            <strong>상대팀에 채워둔 다른 챔피언들도</strong> 함께 봐서, 상대에 탱커가 없으면 암살자를, 상대가
            전사/암살자 위주면 튼튼한 후보를 조금 더 우선해요(<span className="comp-fit-badge">상대팀 조합에 적합</span>{" "}
            배지로 표시 — 실제 승률보다는 낮은 비중). 그 외에 이미 양 팀 다 채워진 라인이 있거나 우리팀 원딜+서포터가
            둘 다 있으면 <strong>실측 데이터 기반 전체 시너지</strong>(실제 스크래핑한 승률을 조합)와{" "}
            <strong>챔피언 특성 기반 조합 분석</strong>(승률이 아니라 Riot 공식 챔피언 태그/능력치로 보는
            역할군·데미지 타입 균형)도 아래에 따로 보여드려요.
          </p>
        </Details>
      )}

      {mode === "advice" && (
        // key={position}로 포지션 탭이 바뀌면 컴포넌트를 통째로 새로
        // 마운트함 — 안 그러면 이전 포지션에서 펼쳐뒀던 티어 편집 패널
        // (openTier, 컴포넌트 내부 상태)이 열린 채로 남아서 새 포지션의
        // 챔피언 목록을 보여주는 상태로 이어져 헷갈릴 수 있음.
        <ChampionPoolEditor
          key={position}
          champions={champions}
          championById={championById}
          positionLabel={POSITIONS.find((p) => p.value === position)?.label ?? position}
          pool={championPool[position as Position]}
          poolApplied={poolApplied}
          onTogglePoolApplied={setPoolApplied}
          onToggleChampion={(tier, championId) => toggleChampionInPool(position as Position, tier, championId)}
        />
      )}

      {mode === "advice" && (
        <div className="recommend-count-row">
          <span className="recommend-count-label">추천 개수</span>
          <div className="recommend-count-tabs">
            {RECOMMEND_COUNT_OPTIONS.map((n) => (
              <button
                key={n}
                type="button"
                className={n === recommendCount ? "tab tab--active" : "tab"}
                onClick={() => setRecommendCount(n)}
              >
                {n}개
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 픽 추천의 10슬롯(우리팀 5 + 상대팀 5)은 아래 selected-bar 카드 안이
          아니라 여기, 페이지 최상위에 별도로 둬서 position: sticky가 body
          전체 스크롤 기준으로 동작하게 함 — selected-bar 카드 안에 있으면
          그 카드(스플래시 아트+버튼 포함, 꽤 큼) 높이만큼만 붙어있다가
          카드가 다 지나가면 같이 스크롤돼버려서, 결과가 긴 픽 추천에서는
          거의 도움이 안 됐음. 모드 탭(.mode-tabs) 바로 아래에 겹치지 않게
          붙도록 top 오프셋을 그만큼 내려서 잡음(globals.css 참고). */}
      {mode === "advice" && (
        <div className="champ-select-teams">
          <div className="champ-select-teams-columns">
            <div className="champ-select-team champ-select-team--ally">
              <span className="draft-team-label">우리팀</span>
              {slots.filter((s) => s.key.startsWith("ally-")).map((slot) => renderChampSelectSlot(slot, "ally"))}
            </div>
            <div className="champ-select-team champ-select-team--enemy">
              <span className="draft-team-label">상대팀</span>
              {slots.filter((s) => s.key.startsWith("enemy-")).map((slot) => renderChampSelectSlot(slot, "enemy"))}
            </div>
          </div>
          {adviceResult && (adviceResult.ccInfo.ally.length > 0 || adviceResult.ccInfo.enemy.length > 0) && (
            <p className="champ-select-cc-total">
              CC 보유 챔피언 — 우리팀 {adviceResult.ccInfo.allyCount}/{adviceResult.ccInfo.ally.length}명 · 상대팀{" "}
              {adviceResult.ccInfo.enemyCount}/{adviceResult.ccInfo.enemy.length}명
            </p>
          )}
        </div>
      )}

      {/* "조합 비교" 탭 — 포지션 없이 우리팀/상대팀 각 5칸만 있는 더 단순한
          보드. 위 픽 추천 보드와 같은 sticky 컨테이너(.champ-select-teams)를
          그대로 재사용해서 스크롤해도 항상 보이는 것도 동일. */}
      {mode === "compcompare" && (
        <div className="champ-select-teams">
          <div className="champ-select-teams-columns">
            <div className="champ-select-team champ-select-team--ally">
              <span className="draft-team-label">우리팀</span>
              {slots.filter((s) => s.key.startsWith("compally-")).map((slot) => renderCompCompareSlot(slot, "ally"))}
            </div>
            <div className="champ-select-team champ-select-team--enemy">
              <span className="draft-team-label">상대팀</span>
              {slots.filter((s) => s.key.startsWith("compenemy-")).map((slot) => renderCompCompareSlot(slot, "enemy"))}
            </div>
          </div>
          {compareResult && (compareResult.ally.ccInfo.length > 0 || compareResult.enemy.ccInfo.length > 0) && (
            <p className="champ-select-cc-total">
              CC 보유 챔피언 — 우리팀 {compareResult.ally.ccInfo.filter((c) => c.hasHardCC).length}/
              {compareResult.ally.ccInfo.length}명 · 상대팀{" "}
              {compareResult.enemy.ccInfo.filter((c) => c.hasHardCC).length}/{compareResult.enemy.ccInfo.length}명
            </p>
          )}
        </div>
      )}

      {mode !== "itembuild" && (
        <section className="selected-bar">
          {mode === "advice" || mode === "compcompare" ? (
            <div className="champ-select-portrait">
              {portraitChampion ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element -- external CDN splash art, no next/image domain config needed */}
                  <img
                    src={championSplashUrl(portraitChampion.slug)}
                    alt={portraitChampion.name}
                    className="champ-select-portrait-img"
                    referrerPolicy="no-referrer"
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                    }}
                  />
                  <span className="champ-select-portrait-name">{portraitChampion.name}</span>
                </>
              ) : (
                <span className="champ-select-portrait-empty">챔피언을 선택하면 여기 크게 보여요</span>
              )}
            </div>
          ) : (
            <div className="slot-row">{slots.map((slot) => renderSlot(slot))}</div>
          )}
          <button type="button" className="run-button" disabled={!canRun || loading} onClick={runLookup}>
            {loading
              ? "조회 중..."
              : mode === "counter"
                ? "카운터 조회"
                : mode === "build"
                  ? "빌드 조회"
                  : "지금 바로 새로고침"}
          </button>
          {(mode === "advice" || mode === "compcompare") && (
            <p className="empty-hint">챔피언을 넣거나 뺄 때마다 자동으로 다시 조회돼요. 버튼은 기다리지 않고 바로 새로고침하고 싶을 때만 누르세요.</p>
          )}
        </section>
      )}

      {champLoadError && <p className="error-banner">{champLoadError}</p>}

      {/* 챔피언 픽커를 평소엔 아예 숨겨뒀다가, 슬롯을 누르면(activateSlot)
          화면 전체를 덮는 오버레이로 띄우고 챔피언을 고르면(assignActiveSlot)
          다시 닫음 — 라인 카운터/빌드(슬롯 1개)와 픽 추천(슬롯 10개) 모두
          같은 방식. 예전엔 라인 카운터/빌드만 픽커를 페이지 하단에 인라인으로
          두고 슬롯을 누르면 그쪽으로 스크롤만 시켜줬는데, 세 모드의 조작
          방식이 서로 다르면 헷갈린다는 피드백을 반영해 전부 오버레이로
          통일함. */}
      {pickerOpen && (
        <div className="champion-picker-overlay" role="dialog" aria-modal="true">
          <div className="champion-picker-overlay-header">
            <span className="champion-picker-overlay-title">{activeSlot?.label ?? "챔피언"} 선택</span>
            <button type="button" className="champion-picker-blank" onClick={blankActiveSlot}>
              빈 슬롯으로 두기
            </button>
            <button
              type="button"
              className="champion-picker-close"
              onClick={() => setPickerOpen(false)}
              aria-label="챔피언 선택 닫기"
            >
              ✕
            </button>
          </div>
          <ChampionPicker
            key={activeSlotKey}
            champions={champions}
            selectedIds={pickerSelectedIds}
            onToggle={assignActiveSlot}
            maxSelect={champions.length || 1}
            quickInput={mode === "compcompare"}
          />
        </div>
      )}

      {/* "아이템 빌드" 탭 전용 오버레이 — 위 챔피언 픽커와 같은 구조지만
          완전히 별도 상태(itemPickerOpen/activeItemSlotIndex)로 열고 닫혀서
          다른 4개 탭의 챔피언 픽커와 서로 간섭하지 않는다. */}
      {itemPickerOpen && activeItemSlotIndex !== null && (
        <div className="champion-picker-overlay" role="dialog" aria-modal="true">
          <div className="champion-picker-overlay-header">
            <span className="champion-picker-overlay-title">슬롯 {activeItemSlotIndex + 1} 아이템 선택</span>
            <button type="button" className="champion-picker-blank" onClick={blankActiveItemSlot}>
              빈 슬롯으로 두기
            </button>
            <button
              type="button"
              className="champion-picker-close"
              onClick={() => setItemPickerOpen(false)}
              aria-label="아이템 선택 닫기"
            >
              ✕
            </button>
          </div>
          <ItemPicker
            items={items}
            selectedIds={itemSlots.filter((id): id is number => id !== null)}
            onSelect={assignActiveItemSlot}
          />
        </div>
      )}

      {mode === "counter" && !loading && counterLookupFailed && (
        <p className="empty-hint">6개 소스 모두에서 카운터 데이터를 가져오지 못했습니다. 잠시 후 다시 시도해보세요.</p>
      )}

      {mode === "counter" && counterResult && (
        <section className="results">
          <h2>
            {counterResult.champion.name} ({POSITIONS.find((p) => p.value === counterResult.position)?.label}) 카운터
          </h2>
          <Details label="설명">
            <p className="empty-hint">
              승률은 {counterResult.champion.name} 기준 상대 챔피언과 붙었을 때의 승률입니다. 낮을수록 상대하기
              까다로운(=카운터) 챔피언입니다. 각 항목의 승률은 표본(게임 수)이 가장 많은 소스 기준이며, 아래에
              표본이 많은 순으로 최대 3개 소스를 함께 보여줍니다.
            </p>
          </Details>
          <SourceStatusNote
            succeeded={counterResult.sourcesSucceeded}
            attempted={counterResult.sourcesAttempted}
            errors={counterResult.sourceErrors}
          />
          <ol className="recommend-list">
            {counterResult.counters.map((c) => (
              <li key={c.championId} className="recommend-row recommend-row--stacked">
                <div className="recommend-row-main">
                  <ChampionIcon src={c.iconUrl} name={c.name} />
                  <span className="recommend-name">{c.name}</span>
                  <WinRateBar rate={c.winRate} games={c.games} />
                </div>
                <div className="badge-row">
                  <PowerCurveBadge earlyWinRate={c.earlyWinRate} lateWinRate={c.lateWinRate} />
                  <PowerCurveVsEnemyBadge fit={c.powerCurveVsMineFit} />
                  <KeyTagBadges tags={c.keyTags} />
                  <ConceptFitBadges fits={c.conceptFits} />
                </div>
                <LaningTipList stats={c.laningStats} abilityDetails={c.abilityDetails} />
                <PowerCurveDetails points={c.powerCurvePoints} />
                <AbilityDetailList abilities={c.abilityDetails} />
                <Details label="소스별 상세">
                  <SourceBreakdown sources={c.bySource} />
                  {c.powerCurveLaneNote && <p className="build-lane-note">⚠ {c.powerCurveLaneNote}</p>}
                  {c.laningStats && <LaningStatsRow stats={c.laningStats} />}
                </Details>
              </li>
            ))}
            {counterResult.counters.length === 0 && (
              <p className="empty-hint">카운터 데이터를 찾지 못했습니다.</p>
            )}
          </ol>

          {counterBuild && (
            <>
              <h3>{counterResult.champion.name} 추천 빌드</h3>
              <BuildCard build={counterBuild} />
            </>
          )}
        </section>
      )}

      {mode === "build" && (buildResultsLolps.length > 0 || buildResultsDeeplol.length > 0) && (
        <section className="results">
          <h2>
            {(buildResultsLolps[0] ?? buildResultsDeeplol[0])!.champion.name} (
            {POSITIONS.find((p) => p.value === (buildResultsLolps[0] ?? buildResultsDeeplol[0])!.position)?.label}) 빌드
          </h2>
          <p className="empty-hint">
            소스 하나당 승률/픽률이 다른 여러 실제 빌드 종류를 보여줘요 — 서로 다른 소스나 변형끼리 승률을
            합산하지 않습니다.
          </p>
          {buildResultsLolps.length > 0 ? (
            buildResultsLolps.map((b, i) => (
              <BuildCard key={`lolps-${i}`} build={b} sourceLabel="lol.ps" variantLabel={buildVariantLabel(i)} />
            ))
          ) : (
            <p className="empty-hint">lol.ps 빌드 데이터를 가져오지 못했습니다.</p>
          )}
          {buildResultsDeeplol.length > 0 ? (
            buildResultsDeeplol.map((b, i) => {
              const diffCount =
                i > 0
                  ? itemSetDiffCount(
                      b.coreItems.map((it) => it.id),
                      buildResultsDeeplol[0].coreItems.map((it) => it.id),
                    )
                  : null;
              return (
                <BuildCard
                  key={`deeplol-${i}`}
                  build={b}
                  sourceLabel="DeepLoL"
                  variantLabel={
                    diffCount !== null ? `${buildVariantLabel(i)} (핵심 아이템 ${diffCount}개 다름)` : buildVariantLabel(i)
                  }
                />
              );
            })
          ) : (
            <p className="empty-hint">DeepLoL 빌드 데이터를 가져오지 못했습니다.</p>
          )}
        </section>
      )}
      {mode === "build" &&
        !loading &&
        buildResultsLolps.length === 0 &&
        buildResultsDeeplol.length === 0 &&
        buildLookupAttempted && (
          <p className="empty-hint">lol.ps와 DeepLoL 모두 빌드 데이터를 가져오지 못했습니다. 잠시 후 다시 시도해보세요.</p>
        )}

      {mode === "itembuild" && (
        <section className="results">
          <h2>아이템 빌드</h2>
          <p className="empty-hint">
            6개 아이템 슬롯을 직접 채워서 조합의 총 가격과 스탯 합계를 확인하세요. 아이템 이름은 물론 위 스탯
            카테고리로도 검색할 수 있습니다. 이름·가격·스탯·설명은 전부 Riot 공식 정적 데이터(Data Dragon
            `item.json`)에서 그대로 가져온 값입니다.
          </p>
          {itemLoadError && <p className="empty-hint">{itemLoadError}</p>}

          <div className="item-build-slots">
            {itemSlots.map((itemId, i) => {
              const item = itemId !== null ? (itemById.get(itemId) ?? null) : null;
              return (
                <button
                  key={i}
                  type="button"
                  className={`item-build-slot${item ? "" : " item-build-slot--empty"}`}
                  onClick={() => (item ? clearItemSlot(i) : activateItemSlot(i))}
                >
                  {item ? (
                    <>
                      <ChampionIcon src={item.iconUrl} name={item.name} className="item-tile-icon" />
                      <span className="item-build-slot-name">{item.name}</span>
                    </>
                  ) : (
                    <span>슬롯 {i + 1}</span>
                  )}
                </button>
              );
            })}
          </div>

          {filledBuildItems.length > 0 && (
            <>
              <h3>합계</h3>
              <p className="empty-hint">
                총 가격 <strong>{itemBuildTotalCost.toLocaleString()}골드</strong> ({filledBuildItems.length}개 아이템)
              </p>
              {itemBuildStatTotals.size > 0 && (
                <div className="item-build-stat-summary">
                  {[...itemBuildStatTotals.entries()].map(([key, value]) => (
                    <span key={key} className="item-build-stat-chip">
                      {statLabel(key)} {formatStatValue(key, value)}
                    </span>
                  ))}
                </div>
              )}
              <p className="empty-hint">
                스탯 합계는 아이템들의 수치를 그대로 더한 값입니다 — 방어력/마법 저항력의 실제 피해 감소 공식 등
                게임 내 계산은 반영하지 않았습니다.
              </p>

              <h3>선택한 아이템</h3>
              <ol className="recommend-list">
                {filledBuildItems.map((item, i) => (
                  <li key={`${item.id}-${i}`} className="recommend-row recommend-row--stacked">
                    <div className="recommend-row-main">
                      <ChampionIcon src={item.iconUrl} name={item.name} className="item-tile-icon" />
                      <span className="recommend-name">{item.name}</span>
                      <span className="item-tile-price">{item.cost.total.toLocaleString()}골드</span>
                    </div>
                    <Details label="상세 정보">
                      {item.plainDescription && <p className="empty-hint">{item.plainDescription}</p>}
                      {Object.keys(item.stats).length > 0 && (
                        <div className="item-build-stat-summary">
                          {Object.entries(item.stats).map(([key, value]) => (
                            <span key={key} className="item-build-stat-chip">
                              {statLabel(key)} {formatStatValue(key, value)}
                            </span>
                          ))}
                        </div>
                      )}
                      {item.tags.length > 0 && <p className="empty-hint">태그: {item.tags.join(", ")}</p>}
                      <p className="empty-hint">
                        기본가 {item.cost.base.toLocaleString()}골드 · 판매가 {item.cost.sell.toLocaleString()}골드
                      </p>
                    </Details>
                  </li>
                ))}
              </ol>
            </>
          )}
        </section>
      )}

      {mode === "advice" && canRun && adviceResult && (
        <section className="results">
          <h2>{POSITIONS.find((p) => p.value === adviceResult.position)?.label} 픽 추천</h2>
          {adviceResult.championPoolActive && (
            <p className="empty-hint">내 챔피언 풀 안에서만, 티어 순서를 우선해서 추천 중입니다.</p>
          )}

          {adviceResult.combinedPicks.length > 0 && (
            <>
              <h3>라인전 + 시너지 둘 다 좋은 픽</h3>
              <Details label="설명">
                <p className="empty-hint">
                  {adviceResult.enemyLaneChampion?.name} 상대 라인전 승률과 {adviceResult.allyAdcChampion?.name}
                  와의 시너지 승률을 평균 낸 순위입니다.
                </p>
              </Details>
              <ol className="recommend-list">
                {adviceResult.combinedPicks.map((c) => (
                  <li key={c.championId} className="recommend-row recommend-row--stacked">
                    <div className="recommend-row-main">
                      <ChampionIcon src={c.iconUrl} name={c.name} />
                      <span className="recommend-name">{c.name}</span>
                      <TierBadge tier={c.tier} />
                    </div>
                    <p className="empty-hint">
                      라인전 {(c.counterWinRate * 100).toFixed(1)}% · 시너지{" "}
                      {(c.synergyWinRate * 100).toFixed(1)}%
                    </p>
                    <div className="badge-row">
                      <CompFitBadge compFit={c.compFit} />
                    </div>
                  </li>
                ))}
              </ol>
            </>
          )}

          {adviceResult.enemyLaneChampion && adviceResult.counterPicks && (
            <>
              <h3>{adviceResult.enemyLaneChampion.name} 상대 라인전 유리한 픽</h3>
              <ol className="recommend-list">
                {adviceResult.counterPicks.map((c) => (
                    <li key={c.championId} className="recommend-row recommend-row--stacked">
                      <div className="recommend-row-main">
                        <ChampionIcon src={c.iconUrl} name={c.name} />
                        <span className="recommend-name">{c.name}</span>
                        <TierBadge tier={c.tier} />
                        <WinRateBar rate={c.winRate} games={c.games} />
                      </div>
                      <div className="badge-row">
                        <PowerCurveBadge earlyWinRate={c.earlyWinRate} lateWinRate={c.lateWinRate} />
                        <PowerCurveVsEnemyBadge fit={c.powerCurveVsEnemyFit} />
                        <CompFitBadge compFit={c.compFit} />
                        <AllySynergyBadge
                          matchCount={c.allySynergyMatchCount}
                          outOf={c.allySynergyOutOf}
                          avgWinRate={c.allySynergyAvgWinRate}
                        />
                        <KeyTagBadges tags={c.keyTags} />
                        <ConceptFitBadges fits={c.conceptFits} />
                      </div>
                      <LaningTipList stats={c.laningStats} abilityDetails={c.abilityDetails} />
                      <PowerCurveDetails points={c.powerCurvePoints} />
                      <AbilityDetailList abilities={c.abilityDetails} />
                      <Details label="세부정보">
                        <SourceBreakdown sources={c.bySource} />
                        {c.powerCurveLaneNote && <p className="build-lane-note">⚠ {c.powerCurveLaneNote}</p>}
                        {c.laningStats && <LaningStatsRow stats={c.laningStats} />}
                        {c.build && <BuildCardCompact build={c.build} sourceLabel="lol.ps" />}
                        {c.buildDeeplol && <BuildCardCompact build={c.buildDeeplol} sourceLabel="DeepLoL" />}
                      </Details>
                    </li>
                  ))}
                  {adviceResult.counterPicks.length === 0 && (
                    <p className="empty-hint">
                      {adviceResult.championPoolActive
                        ? "내 챔피언 풀 안에는 이 상대에 대한 카운터 데이터가 없습니다. 풀을 넓혀보세요."
                        : "카운터 데이터를 찾지 못했습니다."}
                    </p>
                )}
              </ol>
            </>
          )}

          {/* 상대 라이너를 아직 안 채웠으면 실제 매치업 승률 자체가 없어서
              바로 위 "라인전 유리한 픽"이 통째로 안 뜸(counterPicks가
              서버에서 null) — 그렇다고 추천을 아예 안 보여주는 대신, 이미
              채운 상대팀/우리팀 조합만으로 낼 수 있는 신호(태그 기반 상대
              조합 적합도 + 실측 아군 시너지)로 내 챔피언 풀 안에서 추천을
              시도함(compFitPicks, computeCompFitPicks 참고). 풀이 없거나
              양 팀 다 아무것도 안 채웠으면 애초에 서버가 null을 주므로,
              그 경우엔 "풀을 등록하면" 안내만 보여줌. */}
          {!adviceResult.enemyLaneChampion && adviceResult.compFitPicks && adviceResult.compFitPicks.length > 0 && (
            <>
              <h3>{POSITIONS.find((p) => p.value === position)?.label} 조합 기반 추천</h3>
              <Details label="설명">
                <p className="empty-hint">
                  상대 라이너가 아직 없어서 실제 라인전 승률 데이터는 없습니다. 대신 지금까지 채운 상대팀 조합에 태그
                  기반으로 잘 맞고, 이미 채운 우리팀과 실측 시너지가 좋은 챔피언을 내 챔피언 풀 안에서 우선순위로
                  보여드려요. 상대 라이너를 채우면 실제 승률 기반 추천으로 바뀝니다.
                </p>
              </Details>
              <ol className="recommend-list">
                {adviceResult.compFitPicks.map((c) => (
                  <li key={c.championId} className="recommend-row recommend-row--stacked">
                    <div className="recommend-row-main">
                      <ChampionIcon src={c.iconUrl} name={c.name} />
                      <span className="recommend-name">{c.name}</span>
                      <TierBadge tier={c.tier} />
                    </div>
                    <div className="badge-row">
                      <CompFitBadge compFit={c.compFit} />
                      <AllySynergyBadge
                        matchCount={c.allySynergyMatchCount}
                        outOf={c.allySynergyOutOf}
                        avgWinRate={c.allySynergyAvgWinRate}
                      />
                      <KeyTagBadges tags={c.keyTags} />
                      <ConceptFitBadges fits={c.conceptFits} />
                    </div>
                    <AbilityDetailList abilities={c.abilityDetails} />
                  </li>
                ))}
              </ol>
            </>
          )}
          {!adviceResult.enemyLaneChampion &&
            (!adviceResult.compFitPicks || adviceResult.compFitPicks.length === 0) &&
            slots.some((s) => s.championId !== null) &&
            (championPool[position as Position][1].length +
              championPool[position as Position][2].length +
              championPool[position as Position][3].length) ===
              0 && (
              <p className="empty-hint">
                상대 라이너가 아직 없어서 실제 승률 기반 추천은 어렵습니다. &ldquo;내 챔피언 풀&rdquo;에 이 포지션의
                챔피언을 등록하면, 지금 채운 상대팀/우리팀 조합을 바탕으로 추천해드려요.
              </p>
            )}

          {adviceResult.allyAdcChampion && adviceResult.synergyPicks && (
            <>
              <h3>{adviceResult.allyAdcChampion.name}와 시너지 좋은 픽</h3>
              <ol className="recommend-list">
                {adviceResult.synergyPicks.map((c) => (
                    <li key={c.championId} className="recommend-row recommend-row--stacked">
                      <div className="recommend-row-main">
                        <ChampionIcon src={c.iconUrl} name={c.name} />
                        <span className="recommend-name">{c.name}</span>
                        <TierBadge tier={c.tier} />
                        <WinRateBar rate={c.winRate} games={c.games} />
                      </div>
                      <div className="badge-row">
                        <PowerCurveBadge earlyWinRate={c.earlyWinRate} lateWinRate={c.lateWinRate} />
                        <CompFitBadge compFit={c.compFit} />
                        <AllySynergyBadge
                          matchCount={c.allySynergyMatchCount}
                          outOf={c.allySynergyOutOf}
                          avgWinRate={c.allySynergyAvgWinRate}
                        />
                        <KeyTagBadges tags={c.keyTags} />
                        <ConceptFitBadges fits={c.conceptFits} />
                      </div>
                      <PowerCurveDetails points={c.powerCurvePoints} />
                      <AbilityDetailList abilities={c.abilityDetails} />
                      <Details label="세부정보">
                        <SourceBreakdown sources={c.bySource} />
                        {c.powerCurveLaneNote && <p className="build-lane-note">⚠ {c.powerCurveLaneNote}</p>}
                        {c.build && <BuildCardCompact build={c.build} sourceLabel="lol.ps" />}
                        {c.buildDeeplol && <BuildCardCompact build={c.buildDeeplol} sourceLabel="DeepLoL" />}
                      </Details>
                    </li>
                  ))}
                  {adviceResult.synergyPicks.length === 0 && (
                    <p className="empty-hint">
                      {adviceResult.championPoolActive
                        ? "내 챔피언 풀 안에는 이 조합에 대한 시너지 데이터가 없습니다. 풀을 넓혀보세요."
                        : "시너지 데이터를 찾지 못했습니다."}
                    </p>
                )}
              </ol>
            </>
          )}

          {(adviceResult.measuredSynergy.lanes.length > 0 || adviceResult.measuredSynergy.duo) && (
            <>
              <h3>실측 데이터 기반 전체 시너지</h3>
              {adviceResult.measuredSynergy.overallScore !== null && (
                <p className="empty-hint">
                  평균 <strong>{(adviceResult.measuredSynergy.overallScore * 100).toFixed(1)}%</strong>
                </p>
              )}
              <Details label="설명">
                <p className="empty-hint">
                  양 팀 다 채워진 라인의 실제 매치업 승률과 우리팀 원딜+서포터의 실제 듀오 승률을 그대로
                  보여줍니다(우리 시점 승률로 환산).
                </p>
              </Details>
              <ol className="recommend-list">
                {adviceResult.measuredSynergy.lanes.map((l) => (
                  <li key={l.position} className="recommend-row recommend-row--stacked">
                    <div className="recommend-row-main">
                      <ChampionIcon src={l.ally.iconUrl} name={l.ally.name} />
                      <span className="recommend-name">
                        {POSITIONS.find((p) => p.value === l.position)?.label}: {l.ally.name} vs{" "}
                        {l.enemy.name}
                      </span>
                      {l.winRate !== null && l.games !== null ? (
                        <WinRateBar rate={l.winRate} games={l.games} />
                      ) : (
                        <span className="empty-hint">이 매치업 데이터를 찾지 못했습니다.</span>
                      )}
                    </div>
                    <LaningTipList stats={l.laningStats} />
                    {(l.bySource.length > 0 || l.laningStats) && (
                      <Details label="세부정보">
                        {l.bySource.length > 0 && <SourceBreakdown sources={l.bySource} />}
                        {l.laningStats && <LaningStatsRow stats={l.laningStats} />}
                      </Details>
                    )}
                  </li>
                ))}
                {adviceResult.measuredSynergy.duo && (
                  <li className="recommend-row recommend-row--stacked">
                    <div className="recommend-row-main">
                      <ChampionIcon
                        src={adviceResult.measuredSynergy.duo.adc.iconUrl}
                        name={adviceResult.measuredSynergy.duo.adc.name}
                      />
                      <span className="recommend-name">
                        바텀 듀오: {adviceResult.measuredSynergy.duo.adc.name} +{" "}
                        {adviceResult.measuredSynergy.duo.support.name}
                      </span>
                      {adviceResult.measuredSynergy.duo.winRate !== null &&
                      adviceResult.measuredSynergy.duo.games !== null ? (
                        <WinRateBar
                          rate={adviceResult.measuredSynergy.duo.winRate}
                          games={adviceResult.measuredSynergy.duo.games}
                        />
                      ) : (
                        <span className="empty-hint">이 조합 데이터를 찾지 못했습니다.</span>
                      )}
                    </div>
                    {adviceResult.measuredSynergy.duo.bySource.length > 0 && (
                      <Details label="세부정보">
                        <SourceBreakdown sources={adviceResult.measuredSynergy.duo.bySource} />
                      </Details>
                    )}
                  </li>
                )}
              </ol>
            </>
          )}

          <h3>팀 파워 커브 (초반/중반/후반)</h3>
          <TeamPowerCurveCard curve={adviceResult.teamPowerCurve} />

          {(adviceResult.compHeuristic.ally || adviceResult.compHeuristic.enemy) && (
            <>
              <h3>챔피언 특성 기반 조합 분석</h3>
              <Details label="조합 분석">
                <p className="empty-hint">
                  승률이 아니라 Riot 공식 챔피언 태그·능력치(공격형/마법형 비중)만 이용한 참고용 체크입니다.
                  CC기·이니시 성향처럼 공식 데이터로 확인 안 되는 항목은 포함하지 않았습니다. 단, 원거리 딜러의
                  치명타/공속/퍼센트 데미지/치명타 데미지 속성, 탱커(탱커 서포터 포함)의 보호막/방어력/데미지
                  감소/회복/체력 탱커 분류, 브루저의 흡혈/공속/탱킹 브루저 분류는 공식 데이터가 아니라 이 앱이
                  직접 정리한 참고용 분류입니다(빌드 유동적 = 매치업에 따라 실제 빌드 방향이 자주 바뀌는 챔피언).
                </p>
                <div className="comp-heuristic-grid">
                  {adviceResult.compHeuristic.ally && (
                    <CompCard title="우리팀" analysis={adviceResult.compHeuristic.ally} championById={championById} />
                  )}
                  {adviceResult.compHeuristic.enemy && (
                    <CompCard title="상대팀" analysis={adviceResult.compHeuristic.enemy} championById={championById} />
                  )}
                </div>
              </Details>
            </>
          )}

          {(adviceResult.compConcepts.ally || adviceResult.compConcepts.enemy) && (
            <>
              <h3>조합 컨셉 (돌진 · 포킹 · 쌍포 · 한타 · 스플릿)</h3>
              <Details label="조합 컨셉">
                <p className="empty-hint">
                  실제 승률 데이터가 아니라, 채워진 챔피언들의 태그·스킬 구성만으로 어떤 컨셉에 가까운지 추정한
                  참고용 체크입니다.
                </p>
                <div className="comp-heuristic-grid">
                  {adviceResult.compConcepts.ally && (
                    <CompConceptCard title="우리팀" analysis={adviceResult.compConcepts.ally} tipsVariant="pilot" />
                  )}
                  {adviceResult.compConcepts.enemy && (
                    <CompConceptCard title="상대팀" analysis={adviceResult.compConcepts.enemy} tipsVariant="counter" />
                  )}
                </div>
                <ConceptMatchupNote matchup={adviceResult.compConcepts.matchup} />
              </Details>
            </>
          )}
        </section>
      )}

      {mode === "compcompare" && canRun && compareResult && (
        <section className="results">
          <h2>조합 비교</h2>
          <p className="empty-hint">
            포지션 구분 없이 우리팀/상대팀 챔피언만으로 파워 커브·AP/AD 데미지 비중·챔피언 속성·조합 컨셉을 나란히
            비교합니다. 위 포지션 탭에서 내가 픽할 포지션을 고르면, 상대팀 5명 중 그 포지션 표본이 많은(=내 맞
            라이너일 확률이 높은) 최대 3명 각각에 대한 실제 카운터 픽 추천도 함께 보여드려요 — 이 부분만 라인
            카운터/픽 추천과 똑같이 실측 스크래핑 승률입니다. 나머지(파워 커브 제외)는 이미 이 앱의 다른 탭에서
            쓰던 참고용 분석(Riot 공식 정적 데이터 기반)을 포지션 없이 빠르게 볼 수 있게 모아둔 것입니다.
          </p>

          {compareResult.likelyEnemyLaners.length > 0 && (
            <>
              <p className="empty-hint">
                상대팀 5명 중 <strong>{POSITIONS.find((p) => p.value === position)?.label}</strong> 표본이 많은
                순으로 최대 3명을 추렸습니다 — lol.ps의 라인 점유율 필드는 신뢰할 수 없다고 이미 확인돼서(항상
                0을 반환), 대신 실제 카운터 조회 표본 게임 수를 근거로 씁니다.
              </p>
              {compareResult.likelyEnemyLaners.map((laner) => (
                <div key={laner.champion.id}>
                  <h3>
                    {laner.champion.name} 상대 라인전 유리한 픽{" "}
                    <span className="empty-hint">(표본 {laner.totalGames.toLocaleString()}게임)</span>
                  </h3>
                  <ol className="recommend-list">
                    {laner.counterPicks.map((c) => (
                      <li key={c.championId} className="recommend-row recommend-row--stacked">
                        <div className="recommend-row-main">
                          <ChampionIcon src={c.iconUrl} name={c.name} />
                          <span className="recommend-name">{c.name}</span>
                          <TierBadge tier={c.tier} />
                          <WinRateBar rate={c.winRate} games={c.games} />
                        </div>
                        <div className="badge-row">
                          <PowerCurveBadge earlyWinRate={c.earlyWinRate} lateWinRate={c.lateWinRate} />
                          <PowerCurveVsEnemyBadge fit={c.powerCurveVsEnemyFit} />
                          <CompFitBadge compFit={c.compFit} />
                          <KeyTagBadges tags={c.keyTags} />
                          <ConceptFitBadges fits={c.conceptFits} />
                        </div>
                        <Details label="소스별 상세">
                          <SourceBreakdown sources={c.bySource} />
                        </Details>
                      </li>
                    ))}
                    {laner.counterPicks.length === 0 && (
                      <p className="empty-hint">카운터 데이터를 찾지 못했습니다.</p>
                    )}
                  </ol>
                </div>
              ))}
            </>
          )}

          <h3>파워 커브 (초반/중반/후반)</h3>
          <div className="comp-heuristic-grid">
            <RosterPowerCurveCard title="우리팀" curve={compareResult.ally.powerCurve} />
            <RosterPowerCurveCard title="상대팀" curve={compareResult.enemy.powerCurve} />
          </div>

          {(compareResult.ally.compHeuristic || compareResult.enemy.compHeuristic) && (
            <>
              <h3>챔피언 특성 기반 조합 분석 (AP/AD 비중 포함)</h3>
              <Details label="조합 분석">
                <p className="empty-hint">
                  승률이 아니라 Riot 공식 챔피언 태그·능력치(공격형/마법형 비중)만 이용한 참고용 체크입니다. 원거리
                  딜러/탱커/브루저 속성 세분화는 공식 데이터가 아니라 이 앱이 직접 정리한 참고용 분류입니다.
                </p>
                <div className="comp-heuristic-grid">
                  {compareResult.ally.compHeuristic && (
                    <CompCard title="우리팀" analysis={compareResult.ally.compHeuristic} championById={championById} />
                  )}
                  {compareResult.enemy.compHeuristic && (
                    <CompCard title="상대팀" analysis={compareResult.enemy.compHeuristic} championById={championById} />
                  )}
                </div>
              </Details>
            </>
          )}

          {(compareResult.ally.compConcepts || compareResult.enemy.compConcepts) && (
            <>
              <h3>조합 컨셉 (돌진 · 포킹 · 쌍포 · 한타 · 스플릿)</h3>
              <Details label="조합 컨셉">
                <p className="empty-hint">
                  실제 승률 데이터가 아니라, 채워진 챔피언들의 태그·스킬 구성만으로 어떤 컨셉에 가까운지 추정한
                  참고용 체크입니다.
                </p>
                <div className="comp-heuristic-grid">
                  {compareResult.ally.compConcepts && (
                    <CompConceptCard title="우리팀" analysis={compareResult.ally.compConcepts} tipsVariant="pilot" />
                  )}
                  {compareResult.enemy.compConcepts && (
                    <CompConceptCard title="상대팀" analysis={compareResult.enemy.compConcepts} tipsVariant="counter" />
                  )}
                </div>
                <ConceptMatchupNote matchup={compareResult.conceptMatchup} />
              </Details>
            </>
          )}
        </section>
      )}

    </main>
  );
}
