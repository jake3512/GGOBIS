export type Position = "top" | "jungle" | "mid" | "adc" | "support";

export const POSITIONS: { value: Position; label: string }[] = [
  { value: "top", label: "탑" },
  { value: "jungle", label: "정글" },
  { value: "mid", label: "미드" },
  { value: "adc", label: "원거리 딜러" },
  { value: "support", label: "서포터" },
];
