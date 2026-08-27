// 브루저(Fighter 태그) 챔피언의 딜/생존 방식 세분화 — adcArchetype.ts/
// tankArchetype.ts와 완전히 같은 성격의 데이터입니다: Data Dragon이나 어떤
// 전적 사이트도 "이 챔피언은 흡혈형 브루저다" 같은 필드를 공식으로
// 제공하지 않으므로, 실측 스크래핑이나 API 값이 아니라 이 앱이 직접
// 정리해서 하드코딩한 일반적인 LoL 지식(킷이 실제로 어떤 방식으로 딜/생존을
// 챙기는지에 대한 참고용 분류)입니다. 패치로 스킬이 개편되면 실제와 달라질
// 수 있고, 여기 없는 챔피언은 "표에 없음"으로 조용히 빠집니다.
//
// Fighter 태그는 서포터(Thresh)·정글 암살자(Kayn, Rengar, LeeSin 등)·마법사
// 하이브리드(Diana, Elise) 등 "브루저"라 부르기 애매한 챔피언까지 폭넓게
// 걸쳐 있어서, 다른 두 표와 달리 태그 하나로 대상을 다 잡지 않고 실제로
// "브루저"로 통하는 핵심 챔피언 풀만 골라 담았습니다 — 나머지 Fighter 태그
// 챔피언은 표에 없는 것과 동일하게 조용히 빠집니다(억지로 채우지 않음).
//
// "흡혈"(lifesteal)은 tankArchetype.ts의 "회복"(regen, 고정/비율 체력 회복
// 스킬)과는 구분됩니다 — 여기서는 킷 자체가 흡혈/암베인(Omnivamp)처럼 입힌
// 피해에 비례해 체력을 되찾는 메커니즘(또는 그런 아이템 빌드가 핵심 정체성인
// 경우)에만 붙입니다.

export type BruiserAttribute = "lifesteal" | "attackSpeed" | "tanky";

export interface BruiserArchetype {
  attributes: BruiserAttribute[];
}

/** Data Dragon 슬러그 기준 — adcArchetype.ts/tankArchetype.ts와 같은 규칙. */
export const BRUISER_ARCHETYPES: Record<string, BruiserArchetype> = {
  Aatrox: { attributes: ["lifesteal"] }, // Q 적중 시 자힐 + 흡혈 위주 빌드
  Warwick: { attributes: ["lifesteal"] }, // 패시브·Q·궁 전부 입힌 피해 비례 흡혈
  Trundle: { attributes: ["lifesteal"] }, // 패시브 처치 흡수 + Q 고정 피해·자힐
  Olaf: { attributes: ["lifesteal"] }, // 궁극기가 직접 흡혈 수치를 부여
  Renekton: { attributes: ["lifesteal"] }, // 분노 상태 Q가 입힌 피해만큼 자힐
  Illaoi: { attributes: ["lifesteal"] }, // 촉수 적중 시 입힌 피해 비례 자힐
  Darius: { attributes: ["lifesteal"] }, // 패시브(출혈 처치 시 회복) + 흡혈 빌드 궁합
  Fiora: { attributes: ["attackSpeed", "lifesteal"] }, // 급소 적중 시 고정 피해+회복, 공속 빌드
  Camille: { attributes: ["attackSpeed", "tanky"] }, // 온힛 고정 피해 패시브 + 튼튼한 결투가
  Jax: { attributes: ["attackSpeed"] }, // 온힛 패시브 + 궁극기 공격 속도 강화
  Irelia: { attributes: ["attackSpeed"] }, // 온힛 고정 피해 패시브, 공속 스택
  Vi: { attributes: ["attackSpeed"] }, // 온힛 스택형 패시브
  Tryndamere: { attributes: ["attackSpeed"] }, // 치명타/공속 전통 빌드
  Yone: { attributes: ["attackSpeed"] }, // 치명타·공속 연계 딜러형 브루저
  Garen: { attributes: ["tanky"] }, // 체력·방어구 위주 빌드, 패시브 체력 재생
  Gnar: { attributes: ["tanky"] }, // 메가 화 변신 시 극단적으로 튼튼해짐
  Gragas: { attributes: ["tanky"] }, // 체력 비례 킷 + 술통 자힐로 두꺼운 몸싸움
  Shyvana: { attributes: ["tanky"] }, // 용화 변신 시 탱커화
  Sett: { attributes: ["tanky"] }, // 패시브(피해 흡수 후 폭발)로 체력 위주 빌드 궁합
  Mordekaiser: { attributes: ["tanky"] }, // 체력 스택형 극탱 브루저
  Urgot: { attributes: ["tanky"] }, // 방어구/체력 위주 근접 딜탱
  Udyr: { attributes: ["tanky"] }, // 자세 전환형, 방어 자세로 튼튼하게 버팀
  Singed: { attributes: ["tanky"] }, // 체력/저항력 위주 탱커성 브루저
};

export function getBruiserArchetype(slug: string): BruiserArchetype | null {
  return BRUISER_ARCHETYPES[slug] ?? null;
}
