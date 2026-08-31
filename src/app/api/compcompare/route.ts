// "조합 비교" 탭 전용 — 포지션 구분 없이 우리팀/상대팀 두 로스터(각각 최대
// 5명, 순서/라인 무관)만 받아서, 이미 이 앱의 다른 곳에서 쓰던 세 가지
// 신호(파워 커브, 챔피언 특성 기반 조합 분석 — AP/AD 데미지 비중 포함,
// 조합 컨셉)를 두 로스터에 각각 계산해 나란히 돌려준다. 새로운 분석 로직은
// 없음 — 전부 analyzeTeamComp/analyzeCompConcepts/getPowerCurve 재사용,
// 포지션 개념만 뺀 것.

import { NextResponse } from "next/server";
import { getChampionsWithFallback, getLatestVersion, type DDragonChampion } from "@/lib/ddragon";
import { analyzeTeamComp, type TeamCompAnalysis } from "@/lib/teamComp";
import {
  analyzeCompConcepts,
  lookupConceptMatchup,
  type CompConceptAnalysis,
  type ConceptMatchup,
} from "@/lib/compConcepts";
import { getChampionAbilitiesWithCache, type ChampionAbilities } from "@/lib/championSkills";
import { getPowerCurve } from "@/lib/sources/lolps";

interface ChampionBrief {
  id: number;
  name: string;
  iconUrl: string;
}

interface RosterPowerCurveEntry extends ChampionBrief {
  earlyWinRate: number | null;
  midWinRate: number | null;
  lateWinRate: number | null;
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

  const [ally, enemy] = await Promise.all([analyzeRoster(allyChamps, version), analyzeRoster(enemyChamps, version)]);

  const conceptMatchup: ConceptMatchup | null =
    ally.compConcepts?.dominant && enemy.compConcepts?.dominant
      ? lookupConceptMatchup(ally.compConcepts.dominant, enemy.compConcepts.dominant)
      : null;

  return NextResponse.json({ ally, enemy, conceptMatchup });
}
