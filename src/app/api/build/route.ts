import { NextResponse } from "next/server";
import {
  getChampionsWithFallback,
  getItemsWithCache,
  getRunesDataWithCache,
  getSummonerSpellsWithCache,
} from "@/lib/ddragon";
import { POSITIONS, type Position } from "@/lib/positions";
import { getChampionBuild as getLolpsChampionBuild } from "@/lib/sources/lolps";
import { getChampionBuild as getDeeplolChampionBuild } from "@/lib/sources/deeplol";
import { toBuildResult } from "@/lib/buildRefs";

const VALID_POSITIONS = new Set(POSITIONS.map((p) => p.value));
const VALID_SOURCES = new Set(["lolps", "deeplol"]);

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const championId = Number(searchParams.get("championId"));
  const position = searchParams.get("position") as Position | null;
  const source = searchParams.get("source") ?? "lolps";

  if (!Number.isInteger(championId)) {
    return NextResponse.json({ error: "championId query param is required" }, { status: 400 });
  }
  if (!position || !VALID_POSITIONS.has(position)) {
    return NextResponse.json(
      { error: `position must be one of: ${[...VALID_POSITIONS].join(", ")}` },
      { status: 400 },
    );
  }
  if (!VALID_SOURCES.has(source)) {
    return NextResponse.json(
      { error: `source must be one of: ${[...VALID_SOURCES].join(", ")}` },
      { status: 400 },
    );
  }

  const champions = await getChampionsWithFallback();
  const champion = champions.find((c) => c.id === championId);
  if (!champion) {
    return NextResponse.json({ error: "Unknown championId" }, { status: 400 });
  }

  try {
    const getBuild = source === "deeplol" ? getDeeplolChampionBuild : getLolpsChampionBuild;
    const [build, items, spells, runesData] = await Promise.all([
      getBuild(championId, position),
      getItemsWithCache(),
      getSummonerSpellsWithCache(),
      getRunesDataWithCache(),
    ]);

    return NextResponse.json(
      toBuildResult(
        { id: champion.id, name: champion.name, iconUrl: champion.iconUrl },
        position,
        build,
        { items, spells, runes: runesData.runes, trees: runesData.trees },
      ),
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "빌드 조회에 실패했습니다." },
      { status: 502 },
    );
  }
}
