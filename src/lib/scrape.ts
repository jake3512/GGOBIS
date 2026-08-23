// Shared helpers for scraping SPA-rendered stat sites: fetch HTML, pull out
// whatever embedded state the framework ships, then walk that data looking
// for arrays shaped like per-champion matchup stats.
//
// Deliberately shape-driven instead of hardcoded object paths: we don't
// know any of these sites' exact page-props schema, so instead of guessing
// `data.props.pageProps.champion.counters` (which breaks the moment a site
// reshuffles its props) we search the whole tree for "an array of objects
// that each have a champion-id-looking field and a win-rate-looking field."
// It's still a guess, just a more resilient one.
//
// Two embedding styles are supported, because they cover the two mainstream
// frameworks this kind of site tends to use:
//   1. A single JSON blob in one <script> tag — Next.js Pages Router's
//      __NEXT_DATA__, Nuxt's __NUXT__, or any generic inline JSON script.
//   2. Next.js App Router's RSC "Flight" stream: many
//      `<script>self.__next_f.push([1,"id:value\n..."])</script>` tags,
//      each carrying newline-separated `id:value` lines where `value` is
//      usually (but not always — some lines are non-JSON module refs)
//      valid JSON once the `id:` prefix is stripped. Confirmed by hand
//      against a live op.gg page — it has migrated to App Router and has
//      no __NEXT_DATA__ at all.

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

const SINGLE_BLOB_PATTERNS = [
  /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/,
  /<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/,
  /window\.__NUXT__\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/,
  /<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/,
];

const FLIGHT_PUSH_PATTERN = /self\.__next_f\.push\((\[[\s\S]*?\])\)/g;

function extractFlightRoots(html: string): unknown[] {
  const roots: unknown[] = [];
  for (const match of html.matchAll(FLIGHT_PUSH_PATTERN)) {
    let args: unknown;
    try {
      args = JSON.parse(match[1]);
    } catch {
      continue;
    }
    if (!Array.isArray(args) || typeof args[1] !== "string") continue;
    for (const line of args[1].split("\n")) {
      const sep = line.indexOf(":");
      if (sep === -1) continue;
      try {
        roots.push(JSON.parse(line.slice(sep + 1)));
      } catch {
        // Not every line is JSON (some are Flight module references like
        // `I[9766,[],""]`) — skip those, we only need the data-bearing ones.
      }
    }
  }
  return roots;
}

/** Every plausible "root" of page data we could find embedded in the HTML,
 * from whichever of the styles above the page actually uses. Throws only if
 * we found nothing at all to search. */
export function extractEmbeddedJsonRoots(html: string, sourceLabel: string): unknown[] {
  const roots: unknown[] = [];

  for (const pattern of SINGLE_BLOB_PATTERNS) {
    const match = html.match(pattern);
    if (!match) continue;
    try {
      roots.push(JSON.parse(match[1]));
    } catch {
      // try the next pattern
    }
  }

  roots.push(...extractFlightRoots(html));

  if (roots.length === 0) {
    throw new Error(
      `Could not find embedded page data on ${sourceLabel} — its page structure may differ from what this app expects.`,
    );
  }
  return roots;
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

function isStatShapedObject(item: unknown): item is RawStatEntry {
  if (item === null || typeof item !== "object" || Array.isArray(item)) return false;
  const keys = Object.keys(item as object);
  const hasChampionId = keys.some((k) => KEY_PATTERNS.championId.test(k));
  const hasWinShape = keys.some(
    (k) => KEY_PATTERNS.winRate.test(k) || KEY_PATTERNS.wins.test(k),
  );
  return hasChampionId && hasWinShape;
}

/** Recursively walks a parsed data tree looking for arrays whose objects
 * look like per-champion matchup stats. Returns every array that matches.
 *
 * Only the matching *objects* within an array are collected, not the raw
 * array itself — some frameworks (React Flight in particular) interleave
 * data objects with non-object marker values (`[false, {...}, {...}]`) in
 * the same array, so requiring every element to match would silently miss
 * real data. */
export function findStatArrays(node: unknown, depth = 0): RawStatEntry[][] {
  if (depth > 12 || node === null || typeof node !== "object") return [];

  if (Array.isArray(node)) {
    const matching = node.filter(isStatShapedObject);
    const collected = matching.length >= 2 ? [matching] : [];
    return [...collected, ...node.flatMap((item) => findStatArrays(item, depth + 1))];
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

/** Best matching array of normalized entries out of everything found across
 * every root of the page's embedded data. */
export function extractBestStatList(roots: unknown[]): NormalizedEntry[] {
  const arrays = roots.flatMap((root) => findStatArrays(root));
  if (arrays.length === 0) return [];
  const best = arrays.reduce((a, b) => (b.length > a.length ? b : a));
  return best.map(normalizeStatEntry).filter((e): e is NormalizedEntry => e !== null);
}
