// Client for Riot's static "Data Dragon" asset feed (champion names, tags,
// icons). This is public, unauthenticated, and unrelated to the rate-limited
// Riot API used for match data — see src/lib/riot.ts for that.

const DDRAGON_BASE = "https://ddragon.leagueoflegends.com";

export function championIconUrl(version: string, imageFileName: string): string {
  return `${DDRAGON_BASE}/cdn/${version}/img/champion/${imageFileName}`;
}

export interface DDragonChampion {
  id: number; // numeric championId, matches participant.championId in match data
  slug: string; // Data Dragon's string id, e.g. "MonkeyKing"
  name: string;
  title: string;
  tags: string[];
  iconUrl: string;
}

let cachedVersion: { value: string; fetchedAt: number } | null = null;
const VERSION_TTL_MS = 60 * 60 * 1000; // 1 hour

export async function getLatestVersion(): Promise<string> {
  if (cachedVersion && Date.now() - cachedVersion.fetchedAt < VERSION_TTL_MS) {
    return cachedVersion.value;
  }
  const res = await fetch(`${DDRAGON_BASE}/api/versions.json`, {
    next: { revalidate: 3600 },
  });
  if (!res.ok) {
    throw new Error(`Data Dragon versions.json request failed: ${res.status}`);
  }
  const versions: string[] = await res.json();
  const latest = versions[0];
  if (!latest) throw new Error("Data Dragon returned no versions");
  cachedVersion = { value: latest, fetchedAt: Date.now() };
  return latest;
}

export async function getChampions(
  locale = "ko_KR",
  version?: string,
): Promise<DDragonChampion[]> {
  const v = version ?? (await getLatestVersion());
  const res = await fetch(
    `${DDRAGON_BASE}/cdn/${v}/data/${locale}/champion.json`,
    { next: { revalidate: 3600 } },
  );
  if (!res.ok) {
    throw new Error(`Data Dragon champion.json request failed: ${res.status}`);
  }
  const body = await res.json();
  const data = body.data as Record<
    string,
    {
      key: string;
      id: string;
      name: string;
      title: string;
      tags: string[];
      image: { full: string };
    }
  >;

  return Object.values(data)
    .map((c) => ({
      id: Number(c.key),
      slug: c.id,
      name: c.name,
      title: c.title,
      tags: c.tags,
      iconUrl: championIconUrl(v, c.image.full),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
}
