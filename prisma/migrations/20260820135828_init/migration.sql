-- CreateTable
CREATE TABLE "Champion" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "iconUrl" TEXT NOT NULL,
    "tags" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ChampionPairStat" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "championAId" INTEGER NOT NULL,
    "championBId" INTEGER NOT NULL,
    "games" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "ChampionMatchupStat" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "championAId" INTEGER NOT NULL,
    "championBId" INTEGER NOT NULL,
    "games" INTEGER NOT NULL DEFAULT 0,
    "winsA" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "ProcessedMatch" (
    "matchId" TEXT NOT NULL PRIMARY KEY,
    "patch" TEXT,
    "queueId" INTEGER,
    "processedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "CollectionCursor" (
    "source" TEXT NOT NULL PRIMARY KEY,
    "cursor" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Champion_key_key" ON "Champion"("key");

-- CreateIndex
CREATE INDEX "ChampionPairStat_championAId_idx" ON "ChampionPairStat"("championAId");

-- CreateIndex
CREATE INDEX "ChampionPairStat_championBId_idx" ON "ChampionPairStat"("championBId");

-- CreateIndex
CREATE UNIQUE INDEX "ChampionPairStat_championAId_championBId_key" ON "ChampionPairStat"("championAId", "championBId");

-- CreateIndex
CREATE INDEX "ChampionMatchupStat_championAId_idx" ON "ChampionMatchupStat"("championAId");

-- CreateIndex
CREATE INDEX "ChampionMatchupStat_championBId_idx" ON "ChampionMatchupStat"("championBId");

-- CreateIndex
CREATE UNIQUE INDEX "ChampionMatchupStat_championAId_championBId_key" ON "ChampionMatchupStat"("championAId", "championBId");
