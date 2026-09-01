// "조합 비교" 탭 전용 — 포지션 구분 없이 우리팀/상대팀 두 로스터(각각 최대
// 5명, 순서/라인 무관)만 받아서, 이미 이 앱의 다른 곳에서 쓰던 세 가지
// 신호(파워 커브, 챔피언 특성 기반 조합 분석 — AP/AD 데미지 비중 포함,
// 조합 컨셉)를 두 로스터에 각각 계산해 나란히 돌려준다. 새로운 분석 로직은
// 없음 — 전부 analyzeTeamComp/analyzeCompConcepts/getPowerCurve 재사용,
// 포지션 개념만 뺀 것.
//
// `position`(선택)이 함께 오면, 상대팀 5명 중 "내 포지션에서 실제로 자주
// 나오는" 상위 3명을 추려서 그 각각에 대한 카운터 픽 추천도 함께 돌려준다
// (likelyEnemyLaners) — 아래 computeLikelyEnemyLaners 참고.

import { NextResponse } from "next/server";
import { getChampionsWithFallback, getLatestVersion, type DDragonChampion } from "@/lib/ddragon";
import { POSITIONS, type Position } from "@/lib/positions";
import { getAggregatedLaneCounters, type AggregatedCounters } from "@/lib/sources/aggregate";
import { analyzeTeamComp, scoreEnemyCompFit, type TeamCompAnalysis } from "@/lib/teamComp";
import {
  analyzeCompConcepts,
  lookupConceptMatchup,
  type CompConceptAnalysis,
  type ConceptMatchup,
} from "@/lib/compConcepts";
import { getChampionAbilitiesWithCache, type ChampionAbilities } from "@/lib/championSkills";
import { getPowerCurve } from "@/lib/sources/lolps";

const VALID_POSITIONS = new Set(POSITIONS.map((p) => p.value));

interface ChampionBrief {
  id: number;
  name: string;
  iconUrl: string;
}

interface RosterPowerCurveEntry extends ChampionBrief {
  earlyWinRate: number | null;
  midWinRate: number | null;
  lateWinRate: number | null;
  /** Full per-minute win-rate line behind the three averages above — see
   * PowerCurveWithLane.points. */
  powerCurvePoints: { minute: number; winRate: number }[];
}

interface RosterPowerCurve {
  perChampion: RosterPowerCurveEntry[];
  teamEarlyWinRate: number | null;
  teamMidWinRate: number | null;
  teamLateWinRate: number | null;
  /** 5명 중 lol.ps가 실제로 커브를 준 인원 수 — 팀 평균은 이 인원만으로
   * 계산됨(빈 자리를 0으로 채우지 않음). */
  sampledCount: number;
}

interface RosterCCEntry {
  championId: number;
  hasHardCC: boolean;
  hasSoftCC: boolean;
}

interface RosterAnalysis {
  champions: ChampionBrief[];
  /** AP/AD 데미지 비중(damageBalance)·역할군 분포·ADC/탱커/브루저 속성
   * 세분화까지 전부 여기 포함 — src/lib/teamComp.ts 참고. */
  compHeuristic: TeamCompAnalysis | null;
  /** 실측 승률이 아닌, 이 앱이 정리한 전략적 분류(돌진/포킹/쌍포/한타/스플릿)
   * — src/lib/compConcepts.ts 참고. */
  compConcepts: CompConceptAnalysis | null;
  powerCurve: RosterPowerCurve;
  ccInfo: RosterCCEntry[];
}

function average(values: number[]): number | null {
  return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

/** 콤마로 구분된 챔피언 ID 목록 파싱 — 다른 라우트들의 parseTierIds와 같은
 * 규칙(잘못된 값은 조용히 버림). */
function parseChampionIds(raw: string | null): number[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n));
}

/** computeTeamPowerCurve(pickadvice/route.ts)와 같은 집계 로직이지만, 포지션
 * 개념이 아예 없다 — 그래서 "요청한 라인과 다르면"이라는 laneNote 캐비어트도
 * 없음(비교할 라인 자체가 없으므로). 각 챔피언 자신의 주 라인 파워 커브를
 * 그대로 보여줄 뿐. */
async function computeRosterPowerCurve(champs: DDragonChampion[]): Promise<RosterPowerCurve> {
  if (champs.length === 0) {
    return { perChampion: [], teamEarlyWinRate: null, teamMidWinRate: null, teamLateWinRate: null, sampledCount: 0 };
  }
  const settled = await Promise.allSettled(champs.map((c) => getPowerCurve(c.id)));
  const perChampion: RosterPowerCurveEntry[] = [];
  settled.forEach((r, i) => {
    if (r.status !== "fulfilled") return;
    const c = champs[i];
    perChampion.push({
      id: c.id,
      name: c.name,
      iconUrl: c.iconUrl,
      earlyWinRate: r.value.earlyWinRate,
      midWinRate: r.value.midWinRate,
      lateWinRate: r.value.lateWinRate,
      powerCurvePoints: r.value.points,
    });
  });
  const collect = (key: "earlyWinRate" | "midWinRate" | "lateWinRate") =>
    average(perChampion.map((p) => p[key]).filter((v): v is number => v !== null));
  return {
    perChampion,
    teamEarlyWinRate: collect("earlyWinRate"),
    teamMidWinRate: collect("midWinRate"),
    teamLateWinRate: collect("lateWinRate"),
    sampledCount: perChampion.length,
  };
}

/** 한 로스터(우리팀 또는 상대팀)에 대해 파워 커브 + 조합 분석 + 조합 컨셉 +
 * CC 보유 여부를 전부 계산. `abilities`는 조합 컨셉/CC 계산에만 쓰이고
 * (fetchAbilitiesMap과 같은 목적 — 챔피언당 Data Dragon 요청 1번, 최대
 * 5명이라 픽 추천의 드래프트 보드 조회와 같은 규모), 실패해도(버전 조회
 * 실패 등) 조합 분석(compHeuristic)·파워 커브는 그것과 무관하게 정상
 * 동작한다 — 오직 compConcepts/ccInfo만 비어있는 채로 남는다. */
async function analyzeRoster(champs: DDragonChampion[], version: string | null): Promise<RosterAnalysis> {
  const abilities = new Map<number, ChampionAbilities>();
  if (version && champs.length > 0) {
    try {
      const results = await Promise.allSettled(champs.map((c) => getChampionAbilitiesWithCache(c.slug, version)));
      results.forEach((r, i) => {
        if (r.status === "fulfilled") abilities.set(champs[i].id, r.value);
      });
    } catch {
      // Data Dragon unreachable — compConcepts/ccInfo just stay empty below.
    }
  }

  const ccInfo: RosterCCEntry[] = champs.flatMap((c) => {
    const a = abilities.get(c.id);
    return a ? [{ championId: c.id, hasHardCC: a.hasHardCC, hasSoftCC: a.hasSoftCC }] : [];
  });

  const powerCurve = await computeRosterPowerCurve(champs);

  return {
    champions: champs.map((c) => ({ id: c.id, name: c.name, iconUrl: c.iconUrl })),
    compHeuristic: analyzeTeamComp(champs),
    compConcepts: analyzeCompConcepts(champs, abilities),
    powerCurve,
    ccInfo,
  };
}

// --- "내 맞 라이너일 확률이 가장 높은 3명" + 픽 추천 형식의 카운터 추천 ---
//
// 이 탭엔 포지션이 없어서 상대 5명 중 누가 내 맞상대일지 알 방법이
// 원래 없다. lol.ps champSummary의 top1LaneId/top1LaneRatio(라인 점유율)로
// 판단하려는 시도(getLaneShare)는 이전에 실측 검증한 결과 필드 자체가
// 신뢰할 수 없어(항상 0을 반환) 이 앱 다른 곳에서도 전부 걷어냈던 값이라
// 여기서도 쓰지 않는다. 대신 이미 신뢰도가 확인된 신호를 재사용한다: 특정
// 포지션 기준 카운터 데이터(getAggregatedLaneCounters)가 op.gg 등에
// "그 챔피언이 그 포지션으로 나온 실제 게임 수" 그 자체다 — 한 번도 그
// 포지션에서 안 나오는 챔피언은 이 조회 자체가 표본이 거의 없거나(또는
// 6개 소스 전부 실패) 나온다. 그래서 상대 5명 각각에 대해 이 조회를
// 해보고, 응답에 담긴 표본 게임 수 합계가 큰 순으로 "내 포지션일 확률이
// 높다"고 판단한다 — 완벽한 확률은 아니지만 이미 검증된 실측 데이터에서
// 나온 정직한 근사치다.
const LIKELY_LANER_COUNT = 3;

interface SourceValueOut {
  sourceId: string;
  sourceLabel: string;
  winRate: number;
  games: number;
}

/** 픽 추천(pickadvice)의 PickEntry와 같은 형식(championId/name/iconUrl/
 * winRate/games/bySource) — "추천형식은 픽 추천과 같게" 요청에 맞춰 클라
 * 이언트가 같은 WinRateBar/CompFitBadge/소스별 상세 컴포넌트를 그대로
 * 재사용할 수 있게 필드를 맞췄다. 아군 시너지/파워 커브 비교/라인전
 * 세부지표처럼 "이미 정해진 포지션의 아군·상대 라인전 상대"가 전제인
 * 신호는 이 탭엔 아예 해당 개념이 없어서 뺐다 — 실제 카운터 승률(real
 * winRate)과 상대팀 조합 적합도(compFit, scoreEnemyCompFit)만 반영한다. */
interface LaneCandidateEntry {
  championId: number;
  name: string;
  iconUrl: string;
  winRate: number;
  games: number;
  bySource: SourceValueOut[];
  compFit: number;
}

interface LikelyEnemyLaner {
  champion: ChampionBrief;
  /** 이 챔피언이 실제로 이 포지션에서 나온 것으로 보이는 표본 게임 수
   * 합계 — "내 맞 라이너일 확률"의 근거가 된 실측 수치를 화면에도 그대로
   * 보여주기 위해 노출. */
  totalGames: number;
  counterPicks: LaneCandidateEntry[];
}

// pickadvice/route.ts의 PICK_REAL_WEIGHT(0.65)/PICK_ENEMY_FIT_WEIGHT(0.15)와
// 같은 4:1 비율(0.8:0.2)로 맞춘 값 — 이 탭엔 아군 시너지 신호가 없어서 그
// 몫(0.2)만큼을 그대로 빼는 대신, 남은 두 신호(real/enemyFit)의 상대적
// 비중은 그대로 유지했다.
const CANDIDATE_REAL_WEIGHT = 0.8;
const CANDIDATE_ENEMY_FIT_WEIGHT = 0.2;

/** 상대 로스터(최대 5명) 중 `position` 기준 표본이 가장 많은 상위
 * LIKELY_LANER_COUNT명을 추려서, 각각에 대해 실제 카운터 데이터(픽 추천의
 * counterPicks와 동일한 원본 데이터/원리)를 조회해 픽 추천 형식으로
 * 돌려준다. 개별 챔피언 조회 실패는 그 챔피언만 후보에서 빠지는
 * best-effort(Promise.allSettled) — 6개 소스가 전부 실패하는 경우가 있는
 * 카운터 조회 특성상(getAggregatedLaneCounters가 던짐), 상대 5명 중
 * 일부만 데이터가 없을 수 있음을 감안. */
async function computeLikelyEnemyLaners(
  enemyChamps: DDragonChampion[],
  position: Position,
  champions: DDragonChampion[],
  champById: Map<number, DDragonChampion>,
): Promise<LikelyEnemyLaner[]> {
  if (enemyChamps.length === 0) return [];

  const settled = await Promise.allSettled(
    enemyChamps.map((c) => getAggregatedLaneCounters(c.slug, position, champions)),
  );

  const withGames = enemyChamps
    .map((champ, i) => {
      const r = settled[i];
      if (r.status !== "fulfilled") return null;
      const totalGames = r.value.entries.reduce((sum, e) => sum + e.primary.games, 0);
      if (totalGames === 0) return null;
      return { champ, totalGames, result: r.value };
    })
    .filter((x): x is { champ: DDragonChampion; totalGames: number; result: AggregatedCounters } => x !== null)
    .sort((a, b) => b.totalGames - a.totalGames)
    .slice(0, LIKELY_LANER_COUNT);

  return withGames.map(({ champ, totalGames, result }) => {
    const candidates: LaneCandidateEntry[] = result.entries
      .map((entry) => {
        const candidate = champById.get(entry.championId);
        if (!candidate) return null;
        const compFit = scoreEnemyCompFit(candidate, enemyChamps);
        return {
          championId: entry.championId,
          name: candidate.name,
          iconUrl: candidate.iconUrl,
          winRate: entry.primary.winRate,
          games: entry.primary.games,
          bySource: entry.bySource.map((s) => ({
            sourceId: s.sourceId,
            sourceLabel: s.sourceLabel,
            winRate: s.winRate,
            games: s.games,
          })),
          compFit,
        };
      })
      .filter((c): c is LaneCandidateEntry => c !== null)
      // 상대(champ)의 winRate가 낮을수록(=이 후보가 champ을 상대로 잘
      // 이긴다는 뜻) 좋은 카운터 — 픽 추천 counterPicks의 "asc" 정렬과
      // 같은 방향. 실제 승률(80%)이 여전히 압도적이고, 상대팀 조합
      // 적합도(20%)는 근소한 차이일 때만 순서를 조금 흔든다.
      .sort((a, b) => {
        const scoreOf = (e: LaneCandidateEntry) =>
          CANDIDATE_REAL_WEIGHT * (1 - e.winRate) + CANDIDATE_ENEMY_FIT_WEIGHT * e.compFit;
        return scoreOf(b) - scoreOf(a);
      });

    return {
      champion: { id: champ.id, name: champ.name, iconUrl: champ.iconUrl },
      totalGames,
      counterPicks: candidates,
    };
  });
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const allyIds = parseChampionIds(searchParams.get("ally"));
  const enemyIds = parseChampionIds(searchParams.get("enemy"));

  if (allyIds.length === 0 && enemyIds.length === 0) {
    return NextResponse.json({ error: "ally 또는 enemy 중 최소 한쪽은 챔피언이 있어야 합니다." }, { status: 400 });
  }

  const champions = await getChampionsWithFallback();
  const champById = new Map(champions.map((c) => [c.id, c]));
  const resolve = (ids: number[]): DDragonChampion[] =>
    ids.flatMap((id) => {
      const c = champById.get(id);
      return c ? [c] : [];
    });

  const allyChamps = resolve(allyIds);
  const enemyChamps = resolve(enemyIds);

  // 조합 컨셉/CC용 Data Dragon 버전 — 실패해도(오프라인 등) analyzeRoster가
  // version=null로 그 부분만 건너뛰고 나머지(조합 분석/파워 커브)는 그대로
  // 진행하도록 넘김.
  const version = await getLatestVersion().catch(() => null);

  // position은 선택 사항 — 없으면(또는 형식이 잘못됐으면) likelyEnemyLaners는
  // 그냥 빈 배열로 남고 나머지(조합 분석/파워 커브)는 그대로 동작한다.
  const positionParam = searchParams.get("position") as Position | null;
  const position = positionParam && VALID_POSITIONS.has(positionParam) ? positionParam : null;

  const [ally, enemy, likelyEnemyLaners] = await Promise.all([
    analyzeRoster(allyChamps, version),
    analyzeRoster(enemyChamps, version),
    position ? computeLikelyEnemyLaners(enemyChamps, position, champions, champById) : Promise.resolve([]),
  ]);

  const conceptMatchup: ConceptMatchup | null =
    ally.compConcepts?.dominant && enemy.compConcepts?.dominant
      ? lookupConceptMatchup(ally.compConcepts.dominant, enemy.compConcepts.dominant)
      : null;

  return NextResponse.json({ ally, enemy, conceptMatchup, likelyEnemyLaners });
}
