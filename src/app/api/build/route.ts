import { NextResponse } from "next/server";
import {
  getChampionsWithFallback,
  getItemsWithCache,
  getRunesDataWithCache,
  getSummonerSpellsWithCache,
} from "@/lib/ddragon";
import { POSITIONS, type Position } from "@/lib/positions";
import { getChampionBuild as getLolpsChampionBuild, laneIdToPosition, type ChampionBuild } from "@/lib/sources/lolps";
import { getChampionBuildVariants as getDeeplolChampionBuildVariants } from "@/lib/sources/deeplol";
import { toBuildResult } from "@/lib/buildRefs";

const MAX_VARIANTS = 5;

const POSITION_LABEL = new Map(POSITIONS.map((p) => [p.value, p.label]));

const VALID_POSITIONS = new Set(POSITIONS.map((p) => p.value));
const VALID_SOURCES = new Set(["lolps", "deeplol"]);

/** lol.ps only ever exposes one build (its champSummary page has no
 * ranked-variant list the way deeplol's build_lst does), so `count` is
 * ignored there and this always resolves to a single-element array — the
 * caller (GET below) doesn't need to know which source it asked for to
 * turn the result into a `builds` array either way. */
async function fetchBuilds(
  source: string,
  championId: number,
  position: Position,
  count: number,
): Promise<ChampionBuild[]> {
  if (source === "deeplol") {
    return getDeeplolChampionBuildVariants(championId, position, count);
  }
  // lol.ps only ever has data for a champion's own primary lane —
  // allowMismatch shows it anyway (with a lane caveat below) instead of
  // failing the whole request when it doesn't match `position`.
  const build = await getLolpsChampionBuild(championId, position, { allowMismatch: true });
  return [build];
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const championId = Number(searchParams.get("championId"));
  const position = searchParams.get("position") as Position | null;
  const source = searchParams.get("source") ?? "lolps";
  // Opt-in: pass e.g. ?variants=3 to get back multiple ranked build
  // variants for this champion+position (currently only deeplol actually
  // has more than one) as { builds: BuildResult[] } instead of the single
  // top BuildResult object below — kept opt-in so every existing caller
  // that doesn't pass this param (라인 카운터's counterBuild fetch) keeps
  // getting the same single-object response shape it always has.
  const variantsParam = searchParams.get("variants");
  const variantCount = variantsParam ? Math.min(MAX_VARIANTS, Math.max(1, Number(variantsParam) || 1)) : null;

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
    const [builds, items, spells, runesData] = await Promise.all([
      fetchBuilds(source, championId, position, variantCount ?? 1),
      getItemsWithCache(),
      getSummonerSpellsWithCache(),
      getRunesDataWithCache(),
    ]);

    const refData = { items, spells, runes: runesData.runes, trees: runesData.trees };
    const results = builds.map((build) => {
      const actualPosition = source === "lolps" ? laneIdToPosition(build.laneId) : position;
      const laneNote =
        actualPosition && actualPosition !== position
          ? `lol.ps는 이 챔피언의 ${POSITION_LABEL.get(actualPosition) ?? actualPosition} 라인 데이터만 갖고 있어요 (요청한 라인: ${POSITION_LABEL.get(position) ?? position}). 아래 빌드는 실제로 ${POSITION_LABEL.get(actualPosition) ?? actualPosition} 기준입니다.`
          : null;
      return toBuildResult(
        { id: champion.id, name: champion.name, iconUrl: champion.iconUrl },
        position,
        build,
        refData,
        laneNote,
      );
    });

    if (variantCount !== null) {
      return NextResponse.json({ builds: results });
    }
    return NextResponse.json(results[0]);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "빌드 조회에 실패했습니다." },
      { status: 502 },
    );
  }
}
