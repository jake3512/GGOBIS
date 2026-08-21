// Shared helpers for scraping SPA-rendered stat sites: fetch HTML, pull out
// whatever embedded JSON state the framework ships (Next.js's
// __NEXT_DATA__, Nuxt's __NUXT__, or a generic inline JSON <script>), then
// walk that JSON looking for arrays shaped like per-champion matchup stats.
//
// Deliberately shape-driven instead of hardcoded object paths: we don't
// know any of these sites' exact page-props schema, so instead of guessing
// `data.props.pageProps.champion.counters` (which breaks the moment a site
// reshuffles its props) we search the whole tree for "an array of objects
// that each have a champion-id-looking field and a win-rate-looking field."
// It's still a guess, just a more resilient one.

const USER_AGENT =
  "Mozilla/5.0 (compatible; semips-lol-app/1.0; personal project, non-commercial)";

export async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
  });
  if (!res.ok) {
    throw new Error(`Request failed (HTTP ${res.status}) for ${url}`);
  }
  return res.text();
}

const EMBEDDED_JSON_PATTERNS = [
  /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/,
  /<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/,
  /window\.__NUXT__\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/,
  /<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/,
];

export function extractEmbeddedJson(html: string, sourceLabel: string): unknown {
  for (const pattern of EMBEDDED_JSON_PATTERNS) {
    const match = html.match(pattern);
    if (!match) continue;
    try {
      return JSON.parse(match[1]);
    } catch {
      // try the next pattern
    }
  }
  throw new Error(
    `Could not find embedded page data on ${sourceLabel} — its page structure may differ from what this app expects.`,
  );
}

const KEY_PATTERNS = {
  championId: /^(champion_?id|opponent_?champion_?id|target_?champion_?id)$/i,
  winRate: /^(win_?rate|win_?ratio)$/i,
  wins: /^wins?$/i,
  games: /^(games?|play_?count|matches?)$/i,
};

export interface RawStatEntry {
  [key: string]: unknown;
}

/** Recursively walks a parsed embedded-JSON tree looking for arrays whose
 * objects look like per-champion matchup stats. Returns every array that
 * matches, largest-first (the real stat table is usually the biggest one
 * that happens to match the shape). */
export function findStatArrays(node: unknown, depth = 0): RawStatEntry[][] {
  if (depth > 12 || node === null || typeof node !== "object") return [];

  if (Array.isArray(node)) {
    const looksLikeStats =
      node.length > 0 &&
      node.every((item) => item !== null && typeof item === "object") &&
      node.some((item) => {
        const keys = Object.keys(item as object);
        const hasChampionId = keys.some((k) => KEY_PATTERNS.championId.test(k));
        const hasWinShape = keys.some(
          (k) => KEY_PATTERNS.winRate.test(k) || KEY_PATTERNS.wins.test(k),
        );
        return hasChampionId && hasWinShape;
      });
    if (looksLikeStats) {
      return [(node as RawStatEntry[]), ...node.flatMap((item) => findStatArrays(item, depth + 1))];
    }
    return node.flatMap((item) => findStatArrays(item, depth + 1));
  }

  return Object.values(node as Record<string, unknown>).flatMap((v) =>
    findStatArrays(v, depth + 1),
  );
}

export interface NormalizedEntry {
  championId: number;
  winRate: number;
  games: number;
}

export function normalizeStatEntry(raw: RawStatEntry): NormalizedEntry | null {
  const championIdKey = Object.keys(raw).find((k) => KEY_PATTERNS.championId.test(k));
  const gamesKey = Object.keys(raw).find((k) => KEY_PATTERNS.games.test(k));
  const winRateKey = Object.keys(raw).find((k) => KEY_PATTERNS.winRate.test(k));
  const winsKey = Object.keys(raw).find((k) => KEY_PATTERNS.wins.test(k));

  const championId = championIdKey ? Number(raw[championIdKey]) : NaN;
  if (!Number.isFinite(championId)) return null;

  const games = gamesKey ? Number(raw[gamesKey]) : 0;

  let winRate: number | null = null;
  if (winRateKey) {
    const v = Number(raw[winRateKey]);
    winRate = v > 1 ? v / 100 : v; // some sites report 53.2, others 0.532
  } else if (winsKey && games > 0) {
    winRate = Number(raw[winsKey]) / games;
  }
  if (winRate === null || !Number.isFinite(winRate)) return null;

  return { championId, winRate, games };
}

/** Best matching array of normalized entries out of everything found in the
 * page's embedded JSON. */
export function extractBestStatList(data: unknown): NormalizedEntry[] {
  const arrays = findStatArrays(data);
  if (arrays.length === 0) return [];
  const best = arrays.reduce((a, b) => (b.length > a.length ? b : a));
  return best.map(normalizeStatEntry).filter((e): e is NormalizedEntry => e !== null);
}
