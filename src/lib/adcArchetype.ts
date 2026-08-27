// 원거리 딜러(Marksman) 챔피언의 공격 속성(치명타/공속/퍼센트 데미지/치명타
// 데미지) 세분화 — CONCEPT_MATCHUPS/CONCEPT_PILOT_TIPS(compConcepts.ts,
// page.tsx)와 같은 종류의 데이터입니다: Data Dragon이나 어떤 전적 사이트도
// "이 챔피언은 치명타형이다" 같은 필드를 공식으로 제공하지 않으므로, 실측
// 스크래핑이나 API 값이 아니라 이 앱이 직접 정리해서 하드코딩한 일반적인 LoL
// 지식(빌드 방향에 대한 참고용 분류)입니다. 패치로 아이템/룬 메타가 바뀌면
// 실제 빌드 방향도 바뀔 수 있어 최신 정보와 다를 수 있고, 여기 없는 챔피언은
// "표에 없음"으로 조용히 빠집니다(0이나 "해당 없음"으로 표시하지 않음) —
// 아는 것만 보여준다는 이 앱의 다른 정적 참고 데이터와 같은 원칙입니다.
// 커버 범위는 실제로 바텀 라인에서 자주 보이는 핵심 챔피언 풀로 한정했고,
// 정글/서포터로도 가는 마크스맨(Kindred, Senna 서포터 등)이나 분류가
// 애매한 챔피언은 억지로 채우지 않고 뺐습니다.

export type AdcAttribute = "critAttackSpeed" | "attackSpeed" | "percentDamage" | "critDamage";

export interface AdcArchetype {
  /** 여러 개 가능 — 예: 카이사는 치명타/공속형이면서 치명타 데미지 스케일링도
   * 갖고 있어서 둘 다 붙습니다. */
  attributes: AdcAttribute[];
  /** 매치업/메타에 따라 실제 빌드 방향(치명타/방어구 관통·고정 피해/온힛)이
   * 자주 달라지는 챔피언 — 바루스, 진이 대표적. `attributes`와 별개로 붙는
   * 꼬리표입니다(빌드가 유동적이라는 것 자체가 하나의 특성). */
  flexibleBuild: boolean;
}

/** Data Dragon 슬러그(예: "Jinx", "KaiSa") 기준 — 다른 소스 어댑터들이 이미
 * 같은 슬러그 변환 규칙을 쓰고 있어 그대로 맞춰뒀습니다. */
export const ADC_ARCHETYPES: Record<string, AdcArchetype> = {
  Aphelios: { attributes: ["attackSpeed"], flexibleBuild: false },
  Ashe: { attributes: ["critAttackSpeed"], flexibleBuild: false },
  Caitlyn: { attributes: ["critAttackSpeed"], flexibleBuild: false },
  Corki: { attributes: ["attackSpeed"], flexibleBuild: true },
  Draven: { attributes: ["critAttackSpeed"], flexibleBuild: false },
  Ezreal: { attributes: ["attackSpeed"], flexibleBuild: true },
  Jhin: { attributes: ["critDamage"], flexibleBuild: true },
  Jinx: { attributes: ["critAttackSpeed"], flexibleBuild: false },
  Kaisa: { attributes: ["critAttackSpeed", "critDamage"], flexibleBuild: false },
  KogMaw: { attributes: ["percentDamage", "attackSpeed"], flexibleBuild: false },
  Lucian: { attributes: ["critAttackSpeed"], flexibleBuild: false },
  MissFortune: { attributes: ["critAttackSpeed"], flexibleBuild: false },
  Nilah: { attributes: ["attackSpeed"], flexibleBuild: false },
  Samira: { attributes: ["critAttackSpeed"], flexibleBuild: false },
  Senna: { attributes: ["critAttackSpeed"], flexibleBuild: false },
  Sivir: { attributes: ["critAttackSpeed"], flexibleBuild: false },
  Smolder: { attributes: ["critAttackSpeed", "percentDamage"], flexibleBuild: false },
  Tristana: { attributes: ["critAttackSpeed"], flexibleBuild: false },
  Twitch: { attributes: ["attackSpeed"], flexibleBuild: true },
  Varus: { attributes: ["attackSpeed"], flexibleBuild: true },
  Vayne: { attributes: ["percentDamage", "attackSpeed"], flexibleBuild: false },
  Xayah: { attributes: ["critAttackSpeed"], flexibleBuild: false },
  Zeri: { attributes: ["attackSpeed"], flexibleBuild: false },
};

export function getAdcArchetype(slug: string): AdcArchetype | null {
  return ADC_ARCHETYPES[slug] ?? null;
}
