// Client for Riot's static "Data Dragon" asset feed (champion names, tags,
// icons, and — importantly for src/lib/sources/ — the canonical slug used
// to build each stat site's champion URLs).

// Static import, not fs.readFile(path.join(process.cwd(), ...)) — a
// runtime-constructed fs path like that is invisible to Next.js's file
// tracing, so Vercel's serverless bundler has no way to know this JSON file
// needs to ship with the function. It silently works in `next dev` (full
// filesystem available) and just as silently 404s/ENOENTs in production,
// which is a well-known Vercel/Next.js gotcha. A static import is bundled
// like any other module import, so it's guaranteed to be present.
import fallbackChampionsData from "../../data/fallback-champions.json";

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
  /** Riot's own 0-10 champion attribute ratings (attack/defense/magic —
   * difficulty omitted, not used here). Used as a rough, official-data-only
   * proxy for physical/magic damage balance in team-comp analysis — not
   * real per-match damage stats, just Riot's own published ratings.
   * Optional because the offline fallback snapshot doesn't carry it. */
  info?: { attack: number; defense: number; magic: number };
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
      info: { attack: number; defense: number; magic: number };
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
      info: { attack: c.info.attack, defense: c.info.defense, magic: c.info.magic },
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

let cachedChampions: { value: DDragonChampion[]; fetchedAt: number } | null = null;
const CHAMPIONS_TTL_MS = 60 * 60 * 1000; // 1 hour

function loadFallbackChampions(): DDragonChampion[] {
  const snapshot = fallbackChampionsData as {
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

/** Champion list for the picker UI. Tries live Data Dragon first (cached for
 * an hour in-process), falling back to the bundled offline snapshot
 * (data/fallback-champions.json) if Data Dragon can't be reached — e.g. a
 * sandboxed environment with no general internet egress. */
export async function getChampionsWithFallback(locale = "ko_KR"): Promise<DDragonChampion[]> {
  if (cachedChampions && Date.now() - cachedChampions.fetchedAt < CHAMPIONS_TTL_MS) {
    return cachedChampions.value;
  }
  try {
    const champions = await getChampions(locale);
    cachedChampions = { value: champions, fetchedAt: Date.now() };
    return champions;
  } catch (err) {
    console.warn("Data Dragon unreachable, using offline fallback champion list:", err);
    return loadFallbackChampions();
  }
}

// --- Items / summoner spells / runes: only needed to turn lol.ps's build
// data (item/spell/rune IDs) into names+icons for display. No offline
// fallback for these (unlike champions) — if Data Dragon is unreachable the
// build feature just fails for that request, same as any other source
// outage in this app.

export interface DDragonItem {
  id: number;
  name: string;
  iconUrl: string;
  /** Item categories straight from Data Dragon's own item.json (e.g.
   * "Armor", "SpellBlock", "Boots", "Consumable"...) — official structured
   * data, used by pick-advice to check whether a champion's recommended
   * build itemizes defensively against the enemy team's damage-type split
   * (see applyBuildFitBonus, src/app/api/pickadvice/route.ts). */
  tags: string[];
}

let cachedItems: { value: Map<number, DDragonItem>; fetchedAt: number } | null = null;

export async function getItemsWithCache(locale = "ko_KR"): Promise<Map<number, DDragonItem>> {
  if (cachedItems && Date.now() - cachedItems.fetchedAt < CHAMPIONS_TTL_MS) {
    return cachedItems.value;
  }
  const v = await getLatestVersion();
  const res = await fetch(`${DDRAGON_BASE}/cdn/${v}/data/${locale}/item.json`, {
    next: { revalidate: 3600 },
  });
  if (!res.ok) throw new Error(`Data Dragon item.json request failed: ${res.status}`);
  const body = await res.json();
  const data = body.data as Record<string, { name: string; image: { full: string }; tags?: string[] }>;
  const map = new Map<number, DDragonItem>();
  for (const [id, item] of Object.entries(data)) {
    map.set(Number(id), {
      id: Number(id),
      name: item.name,
      iconUrl: `${DDRAGON_BASE}/cdn/${v}/img/item/${item.image.full}`,
      tags: item.tags ?? [],
    });
  }
  cachedItems = { value: map, fetchedAt: Date.now() };
  return map;
}

export interface DDragonSpell {
  id: number;
  name: string;
  iconUrl: string;
}

let cachedSpells: { value: Map<number, DDragonSpell>; fetchedAt: number } | null = null;

export async function getSummonerSpellsWithCache(locale = "ko_KR"): Promise<Map<number, DDragonSpell>> {
  if (cachedSpells && Date.now() - cachedSpells.fetchedAt < CHAMPIONS_TTL_MS) {
    return cachedSpells.value;
  }
  const v = await getLatestVersion();
  const res = await fetch(`${DDRAGON_BASE}/cdn/${v}/data/${locale}/summoner.json`, {
    next: { revalidate: 3600 },
  });
  if (!res.ok) throw new Error(`Data Dragon summoner.json request failed: ${res.status}`);
  const body = await res.json();
  const data = body.data as Record<string, { key: string; name: string; image: { full: string } }>;
  const map = new Map<number, DDragonSpell>();
  for (const spell of Object.values(data)) {
    map.set(Number(spell.key), {
      id: Number(spell.key),
      name: spell.name,
      iconUrl: `${DDRAGON_BASE}/cdn/${v}/img/spell/${spell.image.full}`,
    });
  }
  cachedSpells = { value: map, fetchedAt: Date.now() };
  return map;
}

export interface DDragonRune {
  id: number;
  name: string;
  iconUrl: string;
}

export interface RunesData {
  /** Keyed by rune TREE id (e.g. 8000 = Precision) — mainRuneCategory /
   * subRuneCategory in lol.ps's data refer to these, not individual runes. */
  trees: Map<number, DDragonRune>;
  /** Keyed by individual rune id (keystones and minor runes alike). */
  runes: Map<number, DDragonRune>;
}

let cachedRunes: { value: RunesData; fetchedAt: number } | null = null;

// Rune icon paths are served from a version-less /cdn/img/ prefix, unlike
// every other Data Dragon asset — a known quirk of this particular file.
function runeIconUrl(icon: string): string {
  return `${DDRAGON_BASE}/cdn/img/${icon}`;
}

export async function getRunesDataWithCache(locale = "ko_KR"): Promise<RunesData> {
  if (cachedRunes && Date.now() - cachedRunes.fetchedAt < CHAMPIONS_TTL_MS) {
    return cachedRunes.value;
  }
  const v = await getLatestVersion();
  const res = await fetch(`${DDRAGON_BASE}/cdn/${v}/data/${locale}/runesReforged.json`, {
    next: { revalidate: 3600 },
  });
  if (!res.ok) throw new Error(`Data Dragon runesReforged.json request failed: ${res.status}`);
  const body = (await res.json()) as {
    id: number;
    name: string;
    icon: string;
    slots: { runes: { id: number; name: string; icon: string }[] }[];
  }[];

  const trees = new Map<number, DDragonRune>();
  const runes = new Map<number, DDragonRune>();
  for (const tree of body) {
    trees.set(tree.id, { id: tree.id, name: tree.name, iconUrl: runeIconUrl(tree.icon) });
    for (const slot of tree.slots) {
      for (const rune of slot.runes) {
        runes.set(rune.id, { id: rune.id, name: rune.name, iconUrl: runeIconUrl(rune.icon) });
      }
    }
  }
  const value = { trees, runes };
  cachedRunes = { value, fetchedAt: Date.now() };
  return value;
}
