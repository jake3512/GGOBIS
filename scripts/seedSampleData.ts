// Generates plausible-looking (but synthetic) champion synergy/matchup win
// rate data so the app is demonstrable without a Riot API key or the days of
// real match collection that would take. Real data always comes from
// scripts/collectMatches.ts — this is a stand-in for local development only.
//
// Uses simple heuristics (tag complementarity + a per-champion hidden
// "strength" rating) plus noise so the recommender's ranking isn't just
// uniform random, then writes it with bulk inserts since a full N^2
// champion-pair matrix is tens of thousands of rows.
//
// Run with: npm run db:seed-sample

import { prisma } from "../src/lib/db";

const MIN_GAMES = 15;
const MAX_GAMES = 600;

function randomInt(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function gaussianNoise(stdDev: number): number {
  // Box-Muller transform
  const u1 = Math.random() || 1e-9;
  const u2 = Math.random();
  return stdDev * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

function tagSynergyBonus(tagsA: string[], tagsB: string[]): number {
  const overlap = tagsA.filter((t) => tagsB.includes(t)).length;
  if (overlap === 0) return 0.035; // complementary kits (e.g. Tank + Mage)
  if (overlap >= Math.min(tagsA.length, tagsB.length)) return -0.02; // redundant roles
  return 0.01;
}

async function main() {
  const champions = await prisma.champion.findMany();
  if (champions.length < 2) {
    throw new Error(
      "No champions in DB yet. Run `npm run db:sync-champions` first.",
    );
  }
  console.log(`Seeding synthetic stats for ${champions.length} champions...`);

  // Hidden per-champion "strength" so matchups aren't symmetric noise.
  const strength = new Map<number, number>();
  for (const c of champions) strength.set(c.id, gaussianNoise(0.06));

  await prisma.championPairStat.deleteMany();
  await prisma.championMatchupStat.deleteMany();
  await prisma.processedMatch.deleteMany();

  const pairRows: { championAId: number; championBId: number; games: number; wins: number }[] = [];
  const matchupRows: { championAId: number; championBId: number; games: number; winsA: number }[] = [];

  for (let i = 0; i < champions.length; i++) {
    for (let j = i + 1; j < champions.length; j++) {
      const a = champions[i];
      const b = champions[j];
      const tagsA = a.tags.split(",");
      const tagsB = b.tags.split(",");

      // Synergy (same team): base 50% + tag complementarity + noise.
      const synergyGames = randomInt(MIN_GAMES, MAX_GAMES);
      const synergyRate = clamp(
        0.5 + tagSynergyBonus(tagsA, tagsB) + gaussianNoise(0.03),
        0.3,
        0.7,
      );
      pairRows.push({
        championAId: a.id,
        championBId: b.id,
        games: synergyGames,
        wins: Math.round(synergyGames * synergyRate),
      });

      // Matchup (opposing teams): base 50% + strength differential + noise.
      const matchupGames = randomInt(MIN_GAMES, MAX_GAMES);
      const aWinRate = clamp(
        0.5 + (strength.get(a.id)! - strength.get(b.id)!) + gaussianNoise(0.02),
        0.25,
        0.75,
      );
      const aWins = Math.round(matchupGames * aWinRate);
      matchupRows.push({ championAId: a.id, championBId: b.id, games: matchupGames, winsA: aWins });
      matchupRows.push({
        championAId: b.id,
        championBId: a.id,
        games: matchupGames,
        winsA: matchupGames - aWins,
      });
    }
  }

  console.log(`Inserting ${pairRows.length} pair rows and ${matchupRows.length} matchup rows...`);
  const CHUNK = 2000;
  for (let i = 0; i < pairRows.length; i += CHUNK) {
    await prisma.championPairStat.createMany({ data: pairRows.slice(i, i + CHUNK) });
  }
  for (let i = 0; i < matchupRows.length; i += CHUNK) {
    await prisma.championMatchupStat.createMany({ data: matchupRows.slice(i, i + CHUNK) });
  }

  console.log("Sample data seeded.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
