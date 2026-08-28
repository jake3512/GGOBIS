"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChampionPicker, type ChampionSummary } from "@/components/ChampionPicker";
import { ChampionIcon } from "@/components/ChampionIcon";
import { WinRateBar } from "@/components/WinRateBar";
import { SourceBreakdown } from "@/components/SourceBreakdown";
import { BuildCard, BuildCardCompact, type BuildResult } from "@/components/BuildCard";
import { Details } from "@/components/Details";
import { POSITIONS, type Position } from "@/lib/positions";

type Mode = "counter" | "advice" | "build";

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

interface CounterEntry {
  championId: number;
  name: string;
  iconUrl: string;
  winRate: number;
  games: number;
  bySource: SourceValue[];
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

type AdcAttribute = "critAttackSpeed" | "attackSpeed" | "percentDamage" | "critDamage";

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

type BruiserAttribute = "lifesteal" | "attackSpeed" | "tanky";

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

export default function Home() {
  const [champions, setChampions] = useState<ChampionSummary[]>([]);
  const [champLoadError, setChampLoadError] = useState<string | null>(null);
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
  const [buildResult, setBuildResult] = useState<BuildResult | null>(null);
  /** DeepLoL's build for the same champion+position — fetched alongside
   * buildResult (lol.ps) as a second, separately-labeled card. The two are
   * mutually best-effort (fetched concurrently via Promise.allSettled in
   * runLookup) — either one failing never blocks the other from showing. */
  const [buildResultDeeplol, setBuildResultDeeplol] = useState<BuildResult | null>(null);
  /** Whether a 빌드 tab lookup has actually completed at least once — lets
   * the render distinguish "haven't queried yet" (show nothing) from
   * "queried and both sources came back empty" (show a hint instead of a
   * silently blank page — see runLookup's build branch). */
  const [buildLookupAttempted, setBuildLookupAttempted] = useState(false);
  /** Build recommendation auto-fetched alongside 라인 카운터's own result, for
   * the same champion+position — separate from buildResult (the dedicated
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
    setLastPickedChampionId(null);
    setBuildResult(null);
    setBuildResultDeeplol(null);
    setBuildLookupAttempted(false);
    setCounterBuild(null);
    setPickerOpen(false);
    if (next === "counter" || next === "build") {
      const nextSlots: Slot[] = [{ key: "target", label: "기준 챔피언", championId: null }];
      setSlots(nextSlots);
      setActiveSlotKey(nextSlots[0].key);
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
    }
  }

  function assignActiveSlot(championId: number) {
    setLastPickedChampionId(championId);
    setSlots((prev) => {
      const next = prev.map((s) => (s.key === activeSlotKey ? { ...s, championId } : s));
      const nextEmpty = next.find((s) => s.key !== activeSlotKey && s.championId === null);
      if (nextEmpty) setActiveSlotKey(nextEmpty.key);
      return next;
    });
    // Picking a champion closes the full-screen picker back down.
    setPickerOpen(false);
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
        const fetchBuild = (source: "lolps" | "deeplol") =>
          fetch(`/api/build?championId=${championId}&position=${position}&source=${source}`).then((r) =>
            r.json().then((d) => ({ ok: r.ok, data: d as BuildResult })),
          );
        const [lolpsResult, deeplolResult] = await Promise.allSettled([
          fetchBuild("lolps"),
          fetchBuild("deeplol"),
        ]);
        if (isStale()) return;
        setBuildResult(lolpsResult.status === "fulfilled" && lolpsResult.value.ok ? lolpsResult.value.data : null);
        setBuildResultDeeplol(
          deeplolResult.status === "fulfilled" && deeplolResult.value.ok ? deeplolResult.value.data : null,
        );
        setBuildLookupAttempted(true);
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
   * 참조가 그대로라 불필요한 재조회가 안 일어남. */
  useEffect(() => {
    if (mode !== "advice" || !canRun) return;
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
      </div>

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

      <section className="selected-bar">
        {mode === "advice" ? (
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
        {mode === "advice" && (
          <p className="empty-hint">챔피언을 넣거나 뺄 때마다 자동으로 다시 조회돼요. 버튼은 기다리지 않고 바로 새로고침하고 싶을 때만 누르세요.</p>
        )}
      </section>

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
            champions={champions}
            selectedIds={pickerSelectedIds}
            onToggle={assignActiveSlot}
            maxSelect={champions.length || 1}
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
                <Details label="소스별 상세">
                  <SourceBreakdown sources={c.bySource} />
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

      {mode === "build" && (buildResult || buildResultDeeplol) && (
        <section className="results">
          <h2>
            {(buildResult ?? buildResultDeeplol)!.champion.name} (
            {POSITIONS.find((p) => p.value === (buildResult ?? buildResultDeeplol)!.position)?.label}) 빌드
          </h2>
          {buildResult ? (
            <BuildCard build={buildResult} sourceLabel="lol.ps" />
          ) : (
            <p className="empty-hint">lol.ps 빌드 데이터를 가져오지 못했습니다.</p>
          )}
          {buildResultDeeplol ? (
            <BuildCard build={buildResultDeeplol} sourceLabel="DeepLoL" />
          ) : (
            <p className="empty-hint">DeepLoL 빌드 데이터를 가져오지 못했습니다.</p>
          )}
        </section>
      )}
      {mode === "build" && !loading && !buildResult && !buildResultDeeplol && buildLookupAttempted && (
        <p className="empty-hint">lol.ps와 DeepLoL 모두 빌드 데이터를 가져오지 못했습니다. 잠시 후 다시 시도해보세요.</p>
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
                        <CompFitBadge compFit={c.compFit} />
                        <AllySynergyBadge
                          matchCount={c.allySynergyMatchCount}
                          outOf={c.allySynergyOutOf}
                          avgWinRate={c.allySynergyAvgWinRate}
                        />
                      </div>
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
                    </div>
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
                      </div>
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

    </main>
  );
}
