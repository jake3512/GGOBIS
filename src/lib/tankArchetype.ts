// 탱커/탱커 서포터(Tank 태그) 챔피언의 생존 방식 세분화 — adcArchetype.ts와
// 완전히 같은 성격의 데이터입니다: Data Dragon이나 어떤 전적 사이트도 "이
// 챔피언은 보호막형 탱커다" 같은 필드를 공식으로 제공하지 않으므로, 실측
// 스크래핑이나 API 값이 아니라 이 앱이 직접 정리해서 하드코딩한 일반적인 LoL
// 지식(각 챔피언 킷이 실제로 어떤 방식으로 생존하는지에 대한 참고용 분류)
// 입니다. 패치로 스킬이 개편되면 실제와 달라질 수 있고, 여기 없는 챔피언은
// "표에 없음"으로 조용히 빠집니다(0이나 "해당 없음"으로 표시하지 않음).
// 탱커 서포터(레오나·나서스 아님·브라움 등)는 Riot이 이미 Tank 태그를 함께
// 붙여두므로 별도 목록 없이 Tank 태그 하나로 순수 탱커와 함께 잡힙니다.
// 커버 범위는 자주 보이는 핵심 탱커 풀로 한정했고, 킷을 봐도 이 다섯 범주
// 중 뚜렷하게 해당하는 게 없는 챔피언(아무무, 세주아니 등)은 억지로 채우지
// 않고 뺐습니다.

export type TankAttribute = "shield" | "armor" | "damageReduction" | "regen" | "health";

export interface TankArchetype {
  /** 여러 개 가능 — 예: 몬드는 체력 스케일링과 회복을 둘 다 킷 핵심으로
   * 씀. */
  attributes: TankAttribute[];
}

/** Data Dragon 슬러그(예: "Chogath", "DrMundo") 기준 — adcArchetype.ts와
 * 같은 규칙. */
export const TANK_ARCHETYPES: Record<string, TankArchetype> = {
  Alistar: { attributes: ["regen", "damageReduction"] }, // 패시브 회복 + 궁 피해 감소
  Blitzcrank: { attributes: ["shield"] }, // 패시브 마나 배리어
  Braum: { attributes: ["shield"] }, // W 보호막
  Chogath: { attributes: ["health"] }, // 패시브 최대 체력 영구 스택
  Galio: { attributes: ["shield", "armor"] }, // W 보호막 + 저항력 연동 패시브
  Leona: { attributes: ["shield"] }, // E 사용 시 보호막
  Malphite: { attributes: ["shield", "armor"] }, // 패시브 체력 비례 보호막 + 방어력 연동 킷
  Maokai: { attributes: ["health", "regen"] }, // 패시브 체력 증가 + 피격 시 회복
  DrMundo: { attributes: ["regen", "health"] }, // 체력 비례 킷 전체 + 강력한 회복
  Nautilus: { attributes: ["shield"] }, // 패시브 스킬 사용 후 보호막
  Ornn: { attributes: ["armor"] }, // 자신·아군 방어력/마법저항 강화 중심 킷
  Poppy: { attributes: ["shield"] }, // 패시브 방패 투척(줍기 전 보호막)
  Rammus: { attributes: ["damageReduction", "armor"] }, // E 방어 자세(퍼센트 피해 감소) + 방어력 연동 킷
  Shen: { attributes: ["damageReduction", "shield"] }, // E 피해 감소 구역 + 궁 보호막
  Sion: { attributes: ["health"] }, // 패시브 처치 시 영구 최대 체력 증가
  Taric: { attributes: ["regen", "armor"] }, // 패시브 연계 자힐/힐 + W로 아군과 방어력 공유
  Zac: { attributes: ["health", "regen"] }, // 킷 전체가 최대 체력 스케일링 + 지속 재생
};

export function getTankArchetype(slug: string): TankArchetype | null {
  return TANK_ARCHETYPES[slug] ?? null;
}
