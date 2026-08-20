// Pulls the current champion list/icons/tags from Data Dragon (public,
// unauthenticated static asset feed) into the Champion table. Falls back to
// a bundled offline snapshot (data/fallback-champions.json) if Data Dragon
// can't be reached (e.g. no general internet egress) — see that file's
// header comment for caveats.
// Run with: npm run db:sync-champions

import { readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../src/lib/db";
import { championIconUrl, getChampions, type DDragonChampion } from "../src/lib/ddragon";

async function loadFallback(): Promise<DDragonChampion[]> {
  const raw = await readFile(
    path.join(__dirname, "..", "data", "fallback-champions.json"),
    "utf-8",
  );
  const snapshot = JSON.parse(raw) as {
    ddragonVersion: string;
    champions: { id: number; slug: string; name: string; title: string; tags: string[] }[];
  };
  return snapshot.champions.map((c) => ({
    id: c.id,
    slug: c.slug,
    name: c.name,
    title: c.title,
    tags: c.tags,
    iconUrl: championIconUrl(snapshot.ddragonVersion, `${c.slug}.png`),
  }));
}

async function main() {
  let champions: DDragonChampion[];
  try {
    champions = await getChampions("ko_KR");
    console.log(`Fetched ${champions.length} champions from Data Dragon`);
  } catch (err) {
    console.warn(
      "Data Dragon unreachable, using bundled offline fallback snapshot instead:",
      (err as Error).message,
    );
    champions = await loadFallback();
    console.log(`Loaded ${champions.length} champions from offline fallback`);
  }

  for (const champ of champions) {
    await prisma.champion.upsert({
      where: { id: champ.id },
      create: {
        id: champ.id,
        key: String(champ.id),
        name: champ.name,
        title: champ.title,
        iconUrl: champ.iconUrl,
        tags: champ.tags.join(","),
      },
      update: {
        name: champ.name,
        title: champ.title,
        iconUrl: champ.iconUrl,
        tags: champ.tags.join(","),
      },
    });
  }

  console.log("Champion table synced.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
