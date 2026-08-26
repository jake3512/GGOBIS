// Turns lol.ps's raw build IDs (items/runes/spells) into the
// {id, name, iconUrl} shape the frontend renders — shared by /api/build
// (full card) and /api/pickadvice (compact card on top candidates) so the
// mapping logic only lives in one place.

import type { DDragonItem, DDragonRune, DDragonSpell } from "@/lib/ddragon";
import type { ChampionBuild } from "@/lib/sources/lolps";

export interface IconRef {
  id: number;
  name: string;
  iconUrl: string;
}

export interface BuildResult {
  champion: { id: number; name: string; iconUrl: string };
  position: string;
  mainRuneTree: IconRef | null;
  mainRunes: IconRef[];
  subRuneTree: IconRef | null;
  subRunes: IconRef[];
  runeWinRate: number | null;
  runeGames: number | null;
  spell1: IconRef | null;
  spell2: IconRef | null;
  startingItems: IconRef[];
  startingWinRate: number | null;
  startingGames: number | null;
  coreItems: IconRef[];
  coreWinRate: number | null;
  coreGames: number | null;
  fullBuildItems: IconRef[];
  shoes: IconRef | null;
  skillMaxOrder: string[];
  skillMaxWinRate: number | null;
  skillMaxGames: number | null;
  skillLevelOrder: string[];
  /** Whole-build-combination win rate/pick rate/games, distinct from the
   * per-section rates above — see ChampionBuild.overallWinRate. null when
   * the source doesn't track this separately (e.g. lol.ps). */
  overallWinRate: number | null;
  overallPickRate: number | null;
  overallGames: number | null;
}

export interface BuildRefData {
  items: Map<number, DDragonItem>;
  spells: Map<number, DDragonSpell>;
  runes: Map<number, DDragonRune>;
  trees: Map<number, DDragonRune>;
}

export function toBuildResult(
  champion: { id: number; name: string; iconUrl: string },
  position: string,
  build: ChampionBuild,
  data: BuildRefData,
): BuildResult {
  const item = (id: number | null): IconRef | null => (id !== null ? (data.items.get(id) ?? null) : null);
  const items$ = (ids: number[]): IconRef[] => ids.map(item).filter((x): x is IconRef => x !== null);
  const spell = (id: number | null): IconRef | null => (id !== null ? (data.spells.get(id) ?? null) : null);
  const rune = (id: number | null): IconRef | null => (id !== null ? (data.runes.get(id) ?? null) : null);
  const runes$ = (ids: number[]): IconRef[] => ids.map(rune).filter((x): x is IconRef => x !== null);
  const tree = (id: number | null): IconRef | null => (id !== null ? (data.trees.get(id) ?? null) : null);

  return {
    champion,
    position,
    mainRuneTree: tree(build.mainRuneTreeId),
    mainRunes: runes$(build.mainRunes),
    subRuneTree: tree(build.subRuneTreeId),
    subRunes: runes$(build.subRunes),
    runeWinRate: build.runeWinRate,
    runeGames: build.runeGames,
    spell1: spell(build.spell1Id),
    spell2: spell(build.spell2Id),
    startingItems: items$(build.startingItemIds),
    startingWinRate: build.startingWinRate,
    startingGames: build.startingGames,
    coreItems: items$(build.coreItemIds),
    coreWinRate: build.coreWinRate,
    coreGames: build.coreGames,
    fullBuildItems: items$(build.fullBuildItemIds),
    shoes: item(build.shoesId),
    skillMaxOrder: build.skillMaxOrder,
    skillMaxWinRate: build.skillMaxWinRate,
    skillMaxGames: build.skillMaxGames,
    skillLevelOrder: build.skillLevelOrder,
    overallWinRate: build.overallWinRate ?? null,
    overallPickRate: build.overallPickRate ?? null,
    overallGames: build.overallGames ?? null,
  };
}
