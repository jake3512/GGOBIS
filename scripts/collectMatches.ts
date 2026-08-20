// Collects ranked solo/duo match data via the official Riot API and
// aggregates it into two stat tables:
//   - ChampionPairStat:    win rate when two champions are on the SAME team (synergy)
//   - ChampionMatchupStat: win rate when two champions are on OPPOSING teams (counters)
//
// Seeds from the platform's Challenger/GM/Master ladder, then "snowballs" by
// also queuing every other player seen in a processed match — this gives far
// more coverage than the ~300 challenger players alone without needing a
// production API key, just more time.
//
// Usage:
//   npm run collect -- --platform kr --tier challenger --max-matches 200
//
// Respects Riot's personal API key rate limit (20 req/s, 100 req/2min) via a
// conservative fixed delay between requests (override with --delay-ms).

import { prisma } from "../src/lib/db";
import {
  getMatch,
  getMatchIdsByPuuid,
  getPuuidBySummonerId,
  getTopTierEntries,
  regionForPlatform,
  sleep,
  type Platform,
} from "../src/lib/riot";

const RANKED_SOLO_QUEUE_ID = 420;

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback: string) => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
  };
  return {
    platform: get("--platform", "kr") as Platform,
    tier: get("--tier", "challenger") as "challenger" | "grandmaster" | "master",
    maxMatches: Number(get("--max-matches", "200")),
    matchesPerPlayer: Number(get("--matches-per-player", "10")),
    delayMs: Number(get("--delay-ms", "1300")),
  };
}

function pacedFetch<T>(delayMs: number, fn: () => Promise<T>): Promise<T> {
  return fn().finally(() => sleep(delayMs));
}

async function recordMatch(matchId: string, region: ReturnType<typeof regionForPlatform>, delayMs: number) {
  const already = await prisma.processedMatch.findUnique({ where: { matchId } });
  if (already) return { newPuuids: [] as string[] };

  const match = await pacedFetch(delayMs, () => getMatch(region, matchId));

  if (match.info.queueId !== RANKED_SOLO_QUEUE_ID) {
    await prisma.processedMatch.create({
      data: { matchId, patch: match.info.gameVersion, queueId: match.info.queueId },
    });
    return { newPuuids: [] as string[] };
  }

  const blue = match.info.participants.filter((p) => p.teamId === 100);
  const red = match.info.participants.filter((p) => p.teamId === 200);
  if (blue.length !== 5 || red.length !== 5) {
    // Remake, early surrender edge case, or arena/non-5v5 mode — skip stats but mark processed.
    await prisma.processedMatch.create({
      data: { matchId, patch: match.info.gameVersion, queueId: match.info.queueId },
    });
    return { newPuuids: [] as string[] };
  }

  const blueWin = blue[0].win;

  await prisma.$transaction(async (tx) => {
    for (const team of [blue, red]) {
      const win = team[0].win;
      for (let i = 0; i < team.length; i++) {
        for (let j = i + 1; j < team.length; j++) {
          const a = Math.min(team[i].championId, team[j].championId);
          const b = Math.max(team[i].championId, team[j].championId);
          await tx.championPairStat.upsert({
            where: { championAId_championBId: { championAId: a, championBId: b } },
            create: { championAId: a, championBId: b, games: 1, wins: win ? 1 : 0 },
            update: { games: { increment: 1 }, wins: { increment: win ? 1 : 0 } },
          });
        }
      }
    }

    for (const a of blue) {
      for (const b of red) {
        await tx.championMatchupStat.upsert({
          where: {
            championAId_championBId: { championAId: a.championId, championBId: b.championId },
          },
          create: {
            championAId: a.championId,
            championBId: b.championId,
            games: 1,
            winsA: blueWin ? 1 : 0,
          },
          update: { games: { increment: 1 }, winsA: { increment: blueWin ? 1 : 0 } },
        });
        await tx.championMatchupStat.upsert({
          where: {
            championAId_championBId: { championAId: b.championId, championBId: a.championId },
          },
          create: {
            championAId: b.championId,
            championBId: a.championId,
            games: 1,
            winsA: blueWin ? 0 : 1,
          },
          update: { games: { increment: 1 }, winsA: { increment: blueWin ? 0 : 1 } },
        });
      }
    }

    await tx.processedMatch.create({
      data: { matchId, patch: match.info.gameVersion, queueId: match.info.queueId },
    });
  });

  return { newPuuids: match.info.participants.map((p) => p.puuid) };
}

async function main() {
  const opts = parseArgs();
  const region = regionForPlatform(opts.platform);
  console.log(
    `Collecting up to ${opts.maxMatches} ranked solo matches from ${opts.platform}/${opts.tier} (region=${region}, delay=${opts.delayMs}ms)`,
  );

  const entries = await pacedFetch(opts.delayMs, () =>
    getTopTierEntries(opts.platform, opts.tier),
  );
  console.log(`Seeded ${entries.length} players from ${opts.tier} ladder`);

  const puuidQueue: string[] = [];
  const seenPuuids = new Set<string>();
  for (const entry of shuffle(entries)) {
    if (entry.puuid) {
      puuidQueue.push(entry.puuid);
    } else if (entry.summonerId) {
      try {
        const puuid = await pacedFetch(opts.delayMs, () =>
          getPuuidBySummonerId(opts.platform, entry.summonerId!),
        );
        puuidQueue.push(puuid);
      } catch (err) {
        console.warn("Failed to resolve summonerId -> puuid, skipping", err);
      }
    }
  }

  let processedCount = 0;
  while (puuidQueue.length > 0 && processedCount < opts.maxMatches) {
    const puuid = puuidQueue.shift()!;
    if (seenPuuids.has(puuid)) continue;
    seenPuuids.add(puuid);

    let matchIds: string[];
    try {
      matchIds = await pacedFetch(opts.delayMs, () =>
        getMatchIdsByPuuid(region, puuid, {
          count: opts.matchesPerPlayer,
          queue: RANKED_SOLO_QUEUE_ID,
        }),
      );
    } catch (err) {
      console.warn(`Failed to fetch match ids for puuid, skipping`, err);
      continue;
    }

    for (const matchId of matchIds) {
      if (processedCount >= opts.maxMatches) break;
      try {
        const { newPuuids } = await recordMatch(matchId, region, opts.delayMs);
        for (const p of newPuuids) {
          if (!seenPuuids.has(p)) puuidQueue.push(p);
        }
        processedCount++;
        if (processedCount % 10 === 0) {
          console.log(`Processed ${processedCount}/${opts.maxMatches} matches`);
        }
      } catch (err) {
        console.warn(`Failed to process match ${matchId}, skipping`, err);
      }
    }
  }

  console.log(`Done. Processed ${processedCount} matches from ${seenPuuids.size} players.`);
}

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
