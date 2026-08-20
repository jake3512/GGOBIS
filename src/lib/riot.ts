// Thin wrapper around the official Riot Games API (developer.riot.com).
//
// This project intentionally uses ONLY this official API for match data —
// no scraping of third-party stat sites. A personal development API key
// (from the Riot developer portal) expires every 24h and is rate-limited to
// roughly 20 requests/second and 100 requests/2min, so the collector script
// (scripts/collectMatches.ts) paces itself against those limits and this
// client retries on 429s using the server's Retry-After header.

const PLATFORM_HOSTS = {
  na1: "na1.api.riotgames.com",
  euw1: "euw1.api.riotgames.com",
  eun1: "eun1.api.riotgames.com",
  kr: "kr.api.riotgames.com",
  jp1: "jp1.api.riotgames.com",
  br1: "br1.api.riotgames.com",
  la1: "la1.api.riotgames.com",
  la2: "la2.api.riotgames.com",
  oc1: "oc1.api.riotgames.com",
  tr1: "tr1.api.riotgames.com",
  ru: "ru.api.riotgames.com",
} as const;
export type Platform = keyof typeof PLATFORM_HOSTS;

const REGIONAL_HOSTS = {
  americas: "americas.api.riotgames.com",
  asia: "asia.api.riotgames.com",
  europe: "europe.api.riotgames.com",
  sea: "sea.api.riotgames.com",
} as const;
export type Region = keyof typeof REGIONAL_HOSTS;

export function regionForPlatform(platform: Platform): Region {
  switch (platform) {
    case "na1":
    case "br1":
    case "la1":
    case "la2":
      return "americas";
    case "kr":
    case "jp1":
      return "asia";
    case "oc1":
      return "sea";
    default:
      return "europe";
  }
}

function apiKey(): string {
  const key = process.env.RIOT_API_KEY;
  if (!key) {
    throw new Error(
      "RIOT_API_KEY is not set. Get a key from https://developer.riot.com/ and add it to .env",
    );
  }
  return key;
}

async function riotFetch<T>(url: string, attempt = 0): Promise<T> {
  const res = await fetch(url, {
    headers: { "X-Riot-Token": apiKey() },
    cache: "no-store",
  });

  if (res.status === 429 && attempt < 5) {
    const retryAfter = Number(res.headers.get("retry-after") ?? "1");
    await sleep((retryAfter + 0.1) * 1000);
    return riotFetch<T>(url, attempt + 1);
  }

  if (!res.ok) {
    throw new Error(`Riot API error ${res.status} for ${url}: ${await res.text()}`);
  }

  return res.json() as Promise<T>;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface LeagueEntryDTO {
  puuid?: string;
  summonerId?: string;
  leaguePoints: number;
  wins: number;
  losses: number;
}

/** Top-tier ladders (Challenger/GM/Master) give a dense pool of high-quality,
 * high-volume ranked players to seed match collection from. */
export async function getTopTierEntries(
  platform: Platform,
  tier: "challenger" | "grandmaster" | "master",
  queue: "RANKED_SOLO_5x5" = "RANKED_SOLO_5x5",
): Promise<LeagueEntryDTO[]> {
  const host = PLATFORM_HOSTS[platform];
  const body = await riotFetch<{ entries: LeagueEntryDTO[] }>(
    `https://${host}/lol/league/v4/${tier}leagues/by-queue/${queue}`,
  );
  return body.entries;
}

export async function getPuuidBySummonerId(
  platform: Platform,
  summonerId: string,
): Promise<string> {
  const host = PLATFORM_HOSTS[platform];
  const body = await riotFetch<{ puuid: string }>(
    `https://${host}/lol/summoner/v4/summoners/${summonerId}`,
  );
  return body.puuid;
}

export async function getMatchIdsByPuuid(
  region: Region,
  puuid: string,
  opts: { count?: number; queue?: number; start?: number } = {},
): Promise<string[]> {
  const host = REGIONAL_HOSTS[region];
  const params = new URLSearchParams({
    start: String(opts.start ?? 0),
    count: String(opts.count ?? 20),
  });
  if (opts.queue) params.set("queue", String(opts.queue));
  return riotFetch<string[]>(
    `https://${host}/lol/match/v5/matches/by-puuid/${puuid}/ids?${params}`,
  );
}

export interface MatchParticipantDTO {
  puuid: string;
  championId: number;
  teamId: number; // 100 (blue) or 200 (red)
  win: boolean;
}

export interface MatchDTO {
  metadata: { matchId: string };
  info: {
    queueId: number;
    gameVersion: string;
    participants: MatchParticipantDTO[];
  };
}

export async function getMatch(region: Region, matchId: string): Promise<MatchDTO> {
  const host = REGIONAL_HOSTS[region];
  return riotFetch<MatchDTO>(`https://${host}/lol/match/v5/matches/${matchId}`);
}
