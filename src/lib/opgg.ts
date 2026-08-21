// Live scraper for op.gg champion stats. No API key, no local database —
// every request re-fetches (through a short in-memory cache) directly from
// op.gg's public pages, per the user's request to pull data "on the fly"
// from an existing stats site instead of aggregating our own.
//
// IMPORTANT CAVEAT: this has not been verified against the live op.gg site
// from this environment (its sandbox blocks outbound requests to op.gg), so
// the URL template and the JSON field names below are a best-effort guess
// based on op.gg's general Next.js page structure, not a confirmed API
// contract. If lookups fail, the error message includes enough detail
// (status code / what we couldn't find) to diagnose and fix quickly — see
// README's "op.gg 연동 관련 주의사항" section.
//
// Approach: op.gg's pages are server-rendered by Next.js, which embeds the
// page's data as JSON in a <script id="__NEXT_DATA__"> tag. Instead of
// depending on exact (and easily-changed) CSS class names, we parse that
// JSON and walk it looking for arrays of objects that look like matchup
// data, rather than hardcoding one exact object path.

import { cached } from "@/lib/cache";

const OPGG_BASE = "https://www.op.gg";
const USER_AGENT =
  "Mozilla/5.0 (compatible; semips-lol-app/1.0; personal project, non-commercial)";

export type Position = "top" | "jungle" | "mid" | "adc" | "support";

export const POSITIONS: { value: Position; label: string }[] = [
  { value: "top", label: "탑" },
  { value: "jungle", label: "정글" },
  { value: "mid", label: "미드" },
  { value: "adc", label: "원거리 딜러" },
  { value: "support", label: "서포터" },
];

// Data Dragon champion slugs that don't match op.gg's URL slug 1:1.
// Confirmed cases go here as we find them — see the caveat above.
const SLUG_OVERRIDES: Record<string, string> = {
  MonkeyKing: "wukong",
};

export function toOpggSlug(dataDragonSlug: string): string {
  return (SLUG_OVERRIDES[dataDragonSlug] ?? dataDragonSlug).toLowerCase();
}

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
  });
  if (!res.ok) {
    throw new Error(`op.gg request failed (HTTP ${res.status}) for ${url}`);
  }
  return res.text();
}

function extractNextData(html: string): unknown {
  const match = html.match(
    /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/,
  );
  if (!match) {
    throw new Error(
      "Could not find __NEXT_DATA__ in the op.gg page — the site's page structure may have changed.",
    );
  }
  try {
    return JSON.parse(match[1]);
  } catch {
    throw new Error("Found __NEXT_DATA__ on the op.gg page but it wasn't valid JSON.");
  }
}

const KEY_PATTERNS = {
  championId: /^(champion_?id|opponent_?champion_?id|target_?champion_?id)$/i,
  winRate: /^(win_?rate|win_?ratio)$/i,
  wins: /^wins?$/i,
  games: /^(games?|play_?count|matches?)$/i,
};

interface RawEntry {
  championId?: number;
  winRate?: number;
  wins?: number;
  games?: number;
  [key: string]: unknown;
}

/** Recursively walks a parsed __NEXT_DATA__ tree looking for the first array
 * whose objects look like per-champion matchup stats (a champion id field
 * plus a win-rate-shaped field). Shape-driven instead of a fixed path so it
 * survives page-props restructuring better than a hardcoded selector would
 * — though it's still fundamentally guessing at op.gg's field names. */
function findStatArrays(node: unknown, depth = 0): RawEntry[][] {
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
    if (looksLikeStats) return [node as RawEntry[]];

    return node.flatMap((item) => findStatArrays(item, depth + 1));
  }

  return Object.values(node as Record<string, unknown>).flatMap((v) =>
    findStatArrays(v, depth + 1),
  );
}

function normalizeEntry(raw: RawEntry): { championId: number; winRate: number; games: number } | null {
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
    winRate = v > 1 ? v / 100 : v; // op.gg may report 53.2 or 0.532
  } else if (winsKey && games > 0) {
    winRate = Number(raw[winsKey]) / games;
  }
  if (winRate === null || !Number.isFinite(winRate)) return null;

  return { championId, winRate, games };
}

export interface LaneCounterEntry {
  championId: number;
  winRate: number; // win rate of OUR champion when facing this one
  games: number;
}

export interface LaneCounters {
  championSlug: string;
  position: Position;
  sourceUrl: string;
  counters: LaneCounterEntry[];
}

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes — be a reasonably light visitor

export async function getLaneCounters(
  dataDragonSlug: string,
  position: Position,
): Promise<LaneCounters> {
  const slug = toOpggSlug(dataDragonSlug);
  return cached(`opgg:counters:${slug}:${position}`, CACHE_TTL_MS, async () => {
    const url = `${OPGG_BASE}/lol/champions/${slug}/counters?position=${position}`;
    const html = await fetchHtml(url);
    const data = extractNextData(html);
    const arrays = findStatArrays(data);
    if (arrays.length === 0) {
      throw new Error(
        `Fetched the op.gg page for ${slug}/${position} but couldn't locate matchup data in it. ` +
          `The page may use a different data shape than expected — see src/lib/opgg.ts.`,
      );
    }
    // Prefer the largest matching array — the real stat table is usually
    // bigger than any small metadata list that happens to match the shape.
    const best = arrays.reduce((a, b) => (b.length > a.length ? b : a));
    const counters = best
      .map(normalizeEntry)
      .filter((e): e is LaneCounterEntry => e !== null);

    return { championSlug: slug, position, sourceUrl: url, counters };
  });
}

export interface DuoSynergy {
  adcSlug: string;
  supportSlug: string;
  sourceUrl: string;
  winRate: number | null;
  games: number | null;
}

/** `supportChampionId` is the numeric Riot championId (Data Dragon's `key`),
 * used to pick the right entry out of the ADC's full duo-partner list —
 * op.gg's own championId values are assumed to be the same Riot ids, which
 * is unverified but the most natural way for op.gg to key this data. */
export async function getBotDuoSynergy(
  adcDataDragonSlug: string,
  supportDataDragonSlug: string,
  supportChampionId: number,
): Promise<DuoSynergy> {
  const adcSlug = toOpggSlug(adcDataDragonSlug);
  const supportSlug = toOpggSlug(supportDataDragonSlug);
  return cached(`opgg:duo:${adcSlug}:${supportSlug}`, CACHE_TTL_MS, async () => {
    const url = `${OPGG_BASE}/lol/champions/${adcSlug}/duos?position=adc`;
    const html = await fetchHtml(url);
    const data = extractNextData(html);
    const arrays = findStatArrays(data);

    for (const arr of arrays) {
      for (const raw of arr) {
        const normalized = normalizeEntry(raw);
        if (normalized && normalized.championId === supportChampionId) {
          return {
            adcSlug,
            supportSlug,
            sourceUrl: url,
            winRate: normalized.winRate,
            games: normalized.games,
          };
        }
      }
    }

    return { adcSlug, supportSlug, sourceUrl: url, winRate: null, games: null };
  });
}
