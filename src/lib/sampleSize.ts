// 표본(게임 수)이 적어서 승률이 순전히 운으로 튄 항목이 표본이 훨씬 많은
// 항목보다 순위표에서 위로 오는 걸 막기 위한 공용 유틸 — 예: 500게임 55%
// 승률 챔피언이 3게임 100% 승률 챔피언보다 항상 위로 와야 함.
//
// 게임 수를 50/100 두 기준으로 3단계 신뢰도 구간(0=가장 신뢰도 높음)으로
// 나눕니다. 정렬 시 이 구간을 최우선으로 삼되, 구간 안에서는 정확한 게임 수
// 차이 자체는 더 이상 안 보고(예: 120게임과 8000게임을 굳이 다시 구분하지
// 않음) 오직 승률(또는 그 외 기존 순위 로직)로만 정렬합니다 — "게임 수로
// 세분화"가 아니라 "표본이 부족한 항목을 걸러내는 신뢰도 구간"이 목적이라
// 딱 이 정도 해상도(3단계)면 충분합니다.
export type SampleReliabilityTier = 0 | 1 | 2;

const HIGH_SAMPLE_THRESHOLD = 100;
const MID_SAMPLE_THRESHOLD = 50;

export function sampleReliabilityTier(games: number): SampleReliabilityTier {
  if (games >= HIGH_SAMPLE_THRESHOLD) return 0;
  if (games >= MID_SAMPLE_THRESHOLD) return 1;
  return 2;
}
