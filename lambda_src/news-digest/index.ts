
import { cachedFetchJson, getCachedJsonBatch, runRedisPipeline } from './_redis';
import { pushover } from './pushover';
const markNoCacheResponse = (_req: unknown) => {};
import { sha256Hex } from './_hash';
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
import { VARIANT_FEEDS, INTEL_SOURCES, type ServerFeed } from './_feeds';
import { classifyByKeyword, type ThreatLevel } from './_classifier';
import { getSourceTier } from './_source-tiers';
import { STORY_TRACK_KEY, STORY_SOURCES_KEY, STORY_PEAK_KEY, DIGEST_ACCUMULATOR_KEY, STORY_TTL, STORY_TRACK_KEY_PREFIX, DIGEST_ACCUMULATOR_TTL } from './_cache-keys';
const getRelayBaseUrl = () => null;
const getRelayHeaders = (h: Record<string, string>) => h;

const RSS_ACCEPT = 'application/rss+xml, application/xml, text/xml, */*';
import { isTransRelevant } from './_trans-filter';
import { aiFilterTransRelevant } from './_trans-ai-filter';

const VALID_VARIANTS = new Set(['full', 'tech', 'finance', 'happy', 'commodity', 'trans']);
const fallbackDigestCache = new Map<string, { data: unknown; ts: number }>();
const ITEMS_PER_FEED = 10;
const MAX_ITEMS_PER_CATEGORY = 30;
const FEED_TIMEOUT_MS = 8_000;
const OVERALL_DEADLINE_MS = 25_000;
const BATCH_CONCURRENCY = 20;

const LEVEL_TO_PROTO: Record<ThreatLevel, string> = {
  critical: 'THREAT_LEVEL_CRITICAL',
  high: 'THREAT_LEVEL_HIGH',
  medium: 'THREAT_LEVEL_MEDIUM',
  low: 'THREAT_LEVEL_LOW',
  info: 'THREAT_LEVEL_UNSPECIFIED',
};

/** Numeric severity values for importanceScore computation (0–100). */
const SEVERITY_SCORES: Record<ThreatLevel, number> = {
  critical: 100,
  high: 75,
  medium: 50,
  low: 25,
  info: 0,
};

/**
 * Importance score component weights (must sum to 1.0).
 * Severity dominates because threat level is the primary signal.
 * Corroboration (independent sources) strongly validates an event.
 * Source tier boosts confidence. Recency is a minor tiebreaker.
 */
const SCORE_WEIGHTS = {
  severity: 0.55,
  sourceTier: 0.2,
  corroboration: 0.15,
  recency: 0.1,
} as const;


interface ParsedItem {
  source: string;
  title: string;
  link: string;
  publishedAt: number;
  isAlert: boolean;
  level: ThreatLevel;
  category: string;
  confidence: number;
  classSource: 'keyword' | 'llm';
  importanceScore: number;
  corroborationCount: number;
  titleHash?: string;
  lang: string;
}

function extractStoryKey(title: string): string {
  const STOP = new Set(['a','an','the','in','on','at','to','for','of','and','or','but','is','are','was','were','has','have','had','its','with','as','by','from','that','this','it','be','will','can','not','no','up','out','over','who','what','how','when','why','says','said','after','before','amid','also','just','now','new','two','one','three','four','five','six','seven','eight','nine','ten']);
  const lower = title
    .toLowerCase()
    .replace(/\s+[-\u2013\u2014]\s+[\w\s.]+$/, '')  // strip attribution suffix
    .replace(/^(breaking|update|exclusive|watch|read|opinion|analysis):\s*/i, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .trim();
  const words = new Set(
    lower.split(/\s+/).filter(w => w.length > 2 && !STOP.has(w))
  );
  // Return sorted significant words — order-independent so different phrasings
  // of the same story share the same key if they share enough vocabulary.
  // Take up to 8 words sorted alphabetically so the key is deterministic.
  return [...words].sort().slice(0, 8).join(' ');
}

function computeImportanceScore(
  level: ThreatLevel,
  source: string,
  corroborationCount: number,
  publishedAt: number,
): number {
  const tier = getSourceTier(source);
  const tierScore = tier === 1 ? 100 : tier === 2 ? 75 : tier === 3 ? 50 : 25;
  const corroborationScore = Math.min(corroborationCount, 5) * 20;
  const ageMs = Date.now() - publishedAt;
  const recencyScore = Math.max(0, 1 - ageMs / (24 * 60 * 60 * 1000)) * 100;
  return Math.round(
    SEVERITY_SCORES[level] * SCORE_WEIGHTS.severity +
    tierScore * SCORE_WEIGHTS.sourceTier +
    corroborationScore * SCORE_WEIGHTS.corroboration +
    recencyScore * SCORE_WEIGHTS.recency,
  );
}

function createTimeoutLinkedController(parentSignal: AbortSignal): {
  controller: AbortController;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  parentSignal.addEventListener('abort', onAbort, { once: true });

  return {
    controller,
    cleanup: () => {
      clearTimeout(timeout);
      parentSignal.removeEventListener('abort', onAbort);
    },
  };
}

async function fetchRssText(
  url: string,
  signal: AbortSignal,
): Promise<string | null> {
  const { controller, cleanup } = createTimeoutLinkedController(signal);

  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': CHROME_UA,
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: controller.signal,
    });
    if (!resp.ok) return null;
    return await resp.text();
  } finally {
    cleanup();
  }
}

async function fetchAndParseRss(
  feed: ServerFeed,
  variant: string,
  signal: AbortSignal,
): Promise<ParsedItem[]> {
  const cacheKey = `rss:feed:v1:${variant}:${feed.url}`;

  try {
    const cached = await cachedFetchJson<ParsedItem[]>(cacheKey, 3600, async () => {
      // Try direct fetch first
      let text = await fetchRssText(feed.url, signal).catch(() => null);

      // Fallback: route through Railway relay (different IP, avoids Vercel blocks)
      if (!text) {
        const relayBase = getRelayBaseUrl();
        if (relayBase) {
          const relayUrl = `${relayBase}/rss?url=${encodeURIComponent(feed.url)}`;
          const { controller, cleanup } = createTimeoutLinkedController(signal);
          try {
            const resp = await fetch(relayUrl, {
              headers: getRelayHeaders({ Accept: RSS_ACCEPT }),
              signal: controller.signal,
            });
            if (resp.ok) text = await resp.text();
          } catch { /* relay also failed */ } finally {
            cleanup();
          }
        }
      }

      if (!text) return null;
      return parseRssXml(text, feed, variant);
    });

    return cached ?? [];
  } catch {
    return [];
  }
}

function parseRssXml(xml: string, feed: ServerFeed, variant: string): ParsedItem[] | null {
  const items: ParsedItem[] = [];

  const itemRegex = /<item[\s>]([\s\S]*?)<\/item>/gi;
  const entryRegex = /<entry[\s>]([\s\S]*?)<\/entry>/gi;

  let matches = [...xml.matchAll(itemRegex)];
  const isAtom = matches.length === 0;
  if (isAtom) matches = [...xml.matchAll(entryRegex)];

  for (const match of matches.slice(0, ITEMS_PER_FEED)) {
    const block = match[1]!;

    const title = extractTag(block, 'title');
    if (!title) continue;

    let link: string;
    if (isAtom) {
      const hrefMatch = block.match(/<link[^>]+href=["']([^"']+)["']/);
      link = hrefMatch?.[1] ?? '';
    } else {
      link = extractTag(block, 'link');
    }
    // Strip non-HTTP links (javascript:, data:, etc.) before any downstream use.
    if (!/^https?:\/\//i.test(link)) link = '';

    const pubDateStr = isAtom
      ? extractTag(block, 'published') || extractTag(block, 'updated')
      : extractTag(block, 'pubDate');
    const parsedDate = pubDateStr ? new Date(pubDateStr) : new Date();
    const publishedAt = Number.isNaN(parsedDate.getTime()) ? Date.now() : parsedDate.getTime();

    const threat = classifyByKeyword(title, variant);
    const isAlert = threat.level === 'critical' || threat.level === 'high';

    items.push({
      source: feed.name,
      title,
      link,
      publishedAt,
      isAlert,
      level: threat.level,
      category: threat.category,
      confidence: threat.confidence,
      classSource: 'keyword',
      importanceScore: 0,
      corroborationCount: 1,
      lang: feed.lang ?? 'en',
    });
  }

  return items.length > 0 ? items : null;
}

const TAG_REGEX_CACHE = new Map<string, { cdata: RegExp; plain: RegExp }>();
const KNOWN_TAGS = ['title', 'link', 'pubDate', 'published', 'updated'] as const;
for (const tag of KNOWN_TAGS) {
  TAG_REGEX_CACHE.set(tag, {
    // Safer regexes with specific character classes to avoid catastrophic backtracking.
    cdata: new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*<\\/${tag}>`, 'i'),
    plain: new RegExp(`<${tag}[^>]*>([^<]*)<\\/${tag}>`, 'i'),
  });
}

function extractTag(xml: string, tag: string): string {
  const cached = TAG_REGEX_CACHE.get(tag);
  // Fallback to cached or new regex (though all expected tags are in cache)
  const cdataRe = cached?.cdata ?? new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*<\\/${tag}>`, 'i');
  const plainRe = cached?.plain ?? new RegExp(`<${tag}[^>]*>([^<]*)<\\/${tag}>`, 'i');

  // Input length limit for defense-in-depth against extremely large tags
  if (xml.length > 50000) return '';

  const cdataMatch = xml.match(cdataRe);
  if (cdataMatch) return cdataMatch[1]!.trim();

  const match = xml.match(plainRe);
  return match ? decodeXmlEntities(match[1]!.trim()) : '';
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

async function enrichWithAiCache(items: ParsedItem[]): Promise<void> {
  const candidates = items.filter(i => i.classSource === 'keyword');
  if (candidates.length === 0) return;

  const keyMap = new Map<string, ParsedItem[]>();
  for (const item of candidates) {
    const hash = (await sha256Hex(item.title.toLowerCase())).slice(0, 16);
    const key = `classify:sebuf:v1:${hash}`;
    const existing = keyMap.get(key) ?? [];
    existing.push(item);
    keyMap.set(key, existing);
  }

  const keys = [...keyMap.keys()];
  const cached = await getCachedJsonBatch(keys);

  for (const [key, relatedItems] of keyMap) {
    const hit = cached.get(key) as { level?: string; category?: string } | undefined;
    if (!hit || hit.level === '_skip' || !hit.level || !hit.category) continue;

    for (const item of relatedItems) {
      if (0.9 <= item.confidence) continue;
      item.level = hit.level as typeof item.level;
      item.category = hit.category;
      item.confidence = 0.9;
      item.classSource = 'llm';
      item.isAlert = hit.level === 'critical' || hit.level === 'high';
    }
  }
}

// ── Story persistence tracking ────────────────────────────────────────────────

function normalizeTitle(title: string): string {
  // \p{L} = any Unicode letter; \p{N} = any Unicode number.
  // The `u` flag is required for Unicode property escapes — without it \w
  // matches only ASCII [A-Za-z0-9_], stripping all Arabic/CJK/Cyrillic chars
  // and collapsing every non-Latin title to the same empty hash.
  return title
    .toLowerCase()
    // Strip source attribution suffixes ("- Reuters", "- reuters.com", etc.)
    // so the same story from different domains hashes identically.
    // Optimized to avoid ReDoS by using more specific patterns and avoiding overlapping quantifiers.
    .replace(/\s+[-\u2013\u2014]\s+[\w.-]+\.(?:com|org|net|co\.uk)\s*$/, '')
    .replace(/\s+[-\u2013\u2014]\s+(?:reuters|ap news|bbc|cnn|al jazeera|france 24|dw news|pbs newshour|cbs news|nbc|abc|associated press|the guardian|nos nieuws|tagesschau|cnbc|the national)\s*$/, '')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

interface StoryTrack {
  firstSeen: number;
  lastSeen: number;
  mentionCount: number;
  sourceCount: number;
  currentScore: number;
  peakScore: number;
}

function derivePhase(track: StoryTrack): string {
  const ageMs = Date.now() - track.firstSeen;
  if (track.mentionCount <= 1) return 'STORY_PHASE_BREAKING';
  if (track.mentionCount <= 5 && ageMs < 2 * 60 * 60 * 1000) return 'STORY_PHASE_DEVELOPING';
  // FADING requires real scores from E1. Until E1 ships, currentScore and
  // peakScore are both 0 (HSETNX placeholders), so this branch is intentionally
  // inactive — stories fall through to SUSTAINED rather than incorrectly FADING.
  if (track.currentScore > 0 && track.peakScore > 0 && track.currentScore < track.peakScore * 0.5) return 'STORY_PHASE_FADING';
  return 'STORY_PHASE_SUSTAINED';
}

/**
 * Batch-read existing story:track hashes from Redis for a list of title hashes.
 * Returns a Map<titleHash, StoryTrack>. Missing entries are absent from the map.
 */
async function readStoryTracks(titleHashes: string[]): Promise<Map<string, StoryTrack>> {
  if (titleHashes.length === 0) return new Map();
  const fields = ['firstSeen', 'lastSeen', 'mentionCount', 'sourceCount', 'currentScore', 'peakScore'];
  const commands = titleHashes.map(h => [
    'HMGET', `${STORY_TRACK_KEY_PREFIX}${h}`, ...fields,
  ]);
  const results = await runRedisPipeline(commands, true);
  const map = new Map<string, StoryTrack>();
  for (let i = 0; i < titleHashes.length; i++) {
    const vals = results[i]?.result as string[] | null;
    if (!vals || !vals[0]) continue; // firstSeen missing → new story
    map.set(titleHashes[i]!, {
      firstSeen:    Number(vals[0]),
      lastSeen:     Number(vals[1] ?? 0),
      mentionCount: Number(vals[2] ?? 0),
      sourceCount:  Number(vals[3] ?? 0),
      currentScore: Number(vals[4] ?? 0),
      peakScore:    Number(vals[5] ?? 0),
    });
  }
  return map;
}

function toProtoItem(item: ParsedItem, storyMeta?: { firstSeen: number; mentionCount: number; sourceCount: number; phase: string }): unknown {
  return {
    source: item.source,
    title: item.title,
    link: item.link,
    publishedAt: item.publishedAt,
    isAlert: item.isAlert,
    importanceScore: item.importanceScore,
    corroborationCount: item.corroborationCount ?? 0,
    storyMeta,
    threat: {
      level: LEVEL_TO_PROTO[item.level],
      category: item.category,
      confidence: item.confidence,
      source: item.classSource,
    },
    locationName: '',
  };
}

export async function listFeedDigest(
  ctx: unknown,
  req: { variant: string; lang: string },
): Promise<unknown> {
  const variant = VALID_VARIANTS.has(req.variant) ? req.variant : 'full';
  const lang = req.lang || 'en';

  const digestCacheKey = `news:digest:v1:${variant}:${lang}`;
  const fallbackKey = `${variant}:${lang}`;

  const empty = (): unknown => ({ categories: {}, feedStatuses: {}, generatedAt: new Date().toISOString() });

  try {
    // cachedFetchJson coalesces concurrent cold-path calls: concurrent requests
    // for the same key share a single buildDigest() run instead of fanning out
    // across all RSS feeds. Returning null skips the Redis write and caches a
    // neg-sentinel (120s) to absorb the request storm during degraded periods.
    const fresh = await cachedFetchJson<unknown>(
      digestCacheKey,
      900,
      async () => {
        const result = await buildDigest(variant, lang);
        const totalItems = Object.values(result.categories).reduce((sum, b) => sum + b.items.length, 0);
        return totalItems > 0 ? result : null;
      },
    );

    if (fresh === null) {
      markNoCacheResponse(ctx.request);
      return fallbackDigestCache.get(fallbackKey)?.data ?? empty();
    }

    if (fallbackDigestCache.size > 50) fallbackDigestCache.clear();
    fallbackDigestCache.set(fallbackKey, { data: fresh, ts: Date.now() });
    return fresh;
  } catch {
    markNoCacheResponse(ctx.request);
    return fallbackDigestCache.get(fallbackKey)?.data ?? empty();
  }
}

const STORY_BATCH_SIZE = 80; // keeps each pipeline call well under Upstash's 1000-command cap

async function writeStoryTracking(items: ParsedItem[], variant: string, lang: string, hashes: string[]): Promise<void> {
  if (items.length === 0) return;
  const now = Date.now();
  const accKey = DIGEST_ACCUMULATOR_KEY(variant, lang);

  for (let batchStart = 0; batchStart < items.length; batchStart += STORY_BATCH_SIZE) {
    const batch = items.slice(batchStart, batchStart + STORY_BATCH_SIZE);
    const commands: Array<Array<string | number>> = [];

    for (let i = 0; i < batch.length; i++) {
      const item = batch[i]!;
      const hash = hashes[batchStart + i]!;
      const trackKey = STORY_TRACK_KEY(hash);
      const sourcesKey = STORY_SOURCES_KEY(hash);
      const peakKey = STORY_PEAK_KEY(hash);
      const score = item.importanceScore;
      const nowStr = String(now);
      const ttl = STORY_TTL;

      commands.push(
        ['HINCRBY', trackKey, 'mentionCount', '1'],
        ['HSET', trackKey,
          'lastSeen', nowStr,
          'currentScore', score,
          'title', item.title,
          'link', item.link,
          'severity', item.level,
          'lang', item.lang,
        ],
        ['HSETNX', trackKey, 'firstSeen', nowStr],
        ['ZADD', peakKey, 'GT', score, 'peak'],
        ['SADD', sourcesKey, item.source],
        ['EXPIRE', trackKey, ttl],
        ['EXPIRE', sourcesKey, ttl],
        ['EXPIRE', peakKey, ttl],
        ['ZADD', accKey, nowStr, hash],
      );
    }

    await runRedisPipeline(commands);
  }

  // Trim accumulator entries older than 48h and refresh TTL
  const cutoff = String(Date.now() - DIGEST_ACCUMULATOR_TTL * 1000);
  await runRedisPipeline([
    ['ZREMRANGEBYSCORE', accKey, '-inf', cutoff],
    ['EXPIRE', accKey, DIGEST_ACCUMULATOR_TTL],
  ]);
}

async function buildDigest(variant: string, lang: string): Promise<unknown> {
  const feedsByCategory = VARIANT_FEEDS[variant] ?? {};
  const feedStatuses: Record<string, string> = {};
  const categories: Record<string, { items: unknown[] }> = {};

  const deadlineController = new AbortController();
  const deadlineTimeout = setTimeout(() => deadlineController.abort(), OVERALL_DEADLINE_MS);

  try {
    const allEntries: Array<{ category: string; feed: ServerFeed }> = [];

    for (const [category, feeds] of Object.entries(feedsByCategory)) {
      const filtered = feeds.filter(f => !f.lang || f.lang === lang);
      for (const feed of filtered) {
        allEntries.push({ category, feed });
      }
    }

    if (variant === 'full') {
      const filteredIntel = INTEL_SOURCES.filter(f => !f.lang || f.lang === lang);
      for (const feed of filteredIntel) {
        allEntries.push({ category: 'intel', feed });
      }
    }

    const results = new Map<string, ParsedItem[]>();
    // Track feeds that actually completed (with or without items) so we can
    // distinguish a genuine timeout (never ran) from a successful empty fetch.
    const completedFeeds = new Set<string>();

    for (let i = 0; i < allEntries.length; i += BATCH_CONCURRENCY) {
      if (deadlineController.signal.aborted) break;

      const batch = allEntries.slice(i, i + BATCH_CONCURRENCY);
      const settled = await Promise.allSettled(
        batch.map(async ({ category, feed }) => {
          const items = await fetchAndParseRss(feed, variant, deadlineController.signal);
          completedFeeds.add(feed.name);
          if (items.length === 0) feedStatuses[feed.name] = 'empty';
          return { category, items };
        }),
      );

      for (const result of settled) {
        if (result.status === 'fulfilled') {
          const { category, items } = result.value;
          const existing = results.get(category) ?? [];
          existing.push(...items);
          results.set(category, existing);
        }
      }
    }

    for (const entry of allEntries) {
      if (!completedFeeds.has(entry.feed.name)) {
        feedStatuses[entry.feed.name] = 'timeout';
      }
    }

    // Flatten ALL items before any truncation so cross-category corroboration is counted.
    const allItems = [...results.values()].flat();

    // Compute sha256 title hashes and build corroboration map in one pass.
    // Hashes are stored on each item for reuse as Redis story-tracking keys.
    const corroborationMap = new Map<string, Set<string>>();
    await Promise.all(allItems.map(async item => {
      const hash = await sha256Hex(normalizeTitle(item.title));
      item.titleHash = hash;
      const sources = corroborationMap.get(hash) ?? new Set<string>();
      sources.add(item.source);
      corroborationMap.set(hash, sources);
    }));

    for (const item of allItems) {
      item.corroborationCount = corroborationMap.get(item.titleHash!)?.size ?? 1;
    }

    // Enrich ALL items with the AI classification cache BEFORE scoring so that
    // importanceScore uses the final (post-LLM) threat level, and truncation
    // discards items based on their true score.
    await enrichWithAiCache(allItems);

    // Compute importance score using final (post-enrichment) threat levels.
    for (const item of allItems) {
      item.importanceScore = computeImportanceScore(
        item.level, item.source, item.corroborationCount, item.publishedAt,
      );
    }

    // Secondary clustering: Jaccard similarity to catch same-story articles
    // with different phrasings (e.g. 7 outlets covering the same court ruling).
    // Two items are the same story if they share >= JACCARD_THRESHOLD of their
    // significant words. Keeps highest-scoring item per cluster.
    const JACCARD_THRESHOLD = 0.18;
    const titleWords = new Map<ParsedItem, Set<string>>();
    for (const item of allItems) {
      titleWords.set(item, extractStoryKey(item.title) ? new Set(extractStoryKey(item.title).split(' ')) : new Set());
    }

    // Union-Find for clustering
    const parent = new Map<ParsedItem, ParsedItem>();
    const getRoot = (x: ParsedItem): ParsedItem => {
      if (parent.get(x) === x) return x;
      const root = getRoot(parent.get(x)!);
      parent.set(x, root);
      return root;
    };
    for (const item of allItems) parent.set(item, item);

    const itemList = allItems;
    for (let i = 0; i < itemList.length; i++) {
      for (let j = i + 1; j < itemList.length; j++) {
        const a = titleWords.get(itemList[i]!)!;
        const b = titleWords.get(itemList[j]!)!;
        if (a.size === 0 || b.size === 0) continue;
        let intersection = 0;
        for (const w of a) { if (b.has(w)) intersection++; }
        const union = a.size + b.size - intersection;
        if (intersection / union >= JACCARD_THRESHOLD) {
          const ra = getRoot(itemList[i]!);
          const rb = getRoot(itemList[j]!);
          if (ra !== rb) parent.set(ra, rb);
        }
      }
    }

    // Build clusters and pick winner (highest importanceScore) per cluster
    const clusterWinner = new Map<ParsedItem, ParsedItem>();
    for (const item of allItems) {
      const root = getRoot(item);
      const current = clusterWinner.get(root);
      if (!current || item.importanceScore > current.importanceScore) {
        clusterWinner.set(root, item);
      }
    }

    // Pool corroboration across clusters
    const clusterSources = new Map<ParsedItem, Set<string>>();
    for (const item of allItems) {
      const root = getRoot(item);
      const sources = clusterSources.get(root) ?? new Set<string>();
      sources.add(item.source);
      clusterSources.set(root, sources);
    }
    for (const item of allItems) {
      const root = getRoot(item);
      const mergedCount = clusterSources.get(root)?.size ?? item.corroborationCount;
      if (mergedCount > item.corroborationCount) {
        item.corroborationCount = mergedCount;
        item.importanceScore = computeImportanceScore(
          item.level, item.source, mergedCount, item.publishedAt,
        );
      }
    }

    // Winning hashes — one per cluster
    const winningHashes = new Set(
      [...clusterWinner.values()].map(i => i.titleHash!)
    );

    // Sort by importanceScore desc, then pubDate desc; then truncate per category.
    const slicedByCategory = new Map<string, ParsedItem[]>();
    for (const [category, items] of results) {
      items.sort((a, b) =>
        b.importanceScore - a.importanceScore || b.publishedAt - a.publishedAt,
      );
      // Filter to only winning items (highest-scoring per story key cluster)
      const dedupedItems = items.filter(item => winningHashes.has(item.titleHash!));
      slicedByCategory.set(category, dedupedItems.slice(0, MAX_ITEMS_PER_CATEGORY));
    }

    // Cross-category deduplication: if the same story (by titleHash) appears
    // in multiple categories, keep only the highest-scoring copy. Lower-scoring
    // duplicates are dropped from their category slice before building the response.
    // Corroboration counts are preserved — they were computed across all items above.
    const globalBestCategory = new Map<string, { category: string; score: number }>();
    for (const [category, items] of slicedByCategory) {
      for (const item of items) {
        const hash = item.titleHash!;
        const existing = globalBestCategory.get(hash);
        if (!existing || item.importanceScore > existing.score) {
          globalBestCategory.set(hash, { category, score: item.importanceScore });
        }
      }
    }
    for (const [category, items] of slicedByCategory) {
      slicedByCategory.set(
        category,
        items.filter(item => globalBestCategory.get(item.titleHash!)?.category === category),
      );
    }

    const allSliced = [...slicedByCategory.values()].flat();
    // titleHash was already set on each item during the corroboration pass above.
    const titleHashes = allSliced.map(i => i.titleHash!);

    const now = Date.now();

    // Read existing story tracking BEFORE writing so we know the previous cycle's
    // mentionCount. We merge read state + this cycle's increment in memory to
    // produce accurate, current StoryMeta without a second Redis round-trip.
    const uniqueHashes = [...new Set(titleHashes)];
    const storyTracks = await readStoryTracks(uniqueHashes).catch(() => new Map<string, StoryTrack>());

    // Write story tracking. Errors never fail the digest build.
    await writeStoryTracking(allSliced, variant, lang, titleHashes).catch((err: unknown) =>
      console.warn('[digest] story tracking write failed:', err),
    );

    for (const [category, sliced] of slicedByCategory) {
      // trans variant: filter noisy categories to trans-relevant items only.
      // Two-pass hybrid filter:
      //   1. Keyword filter (fast, zero-cost) — keep clear hits
      //   2. AI filter via Ollama (semantic) — rescue keyword-missed items
      // Applied to: community (broad LGBTQ+ RSS), legal (broad keyword queries),
      //             mainstream (general news outlets)
      const TRANS_FILTERED_CATEGORIES = new Set(['community', 'legal', 'mainstream', 'safety', 'international', 'uk-press', 'wins']);
      let filteredSliced = sliced;
      if (variant === 'trans' && TRANS_FILTERED_CATEGORIES.has(category)) {
        const keywordPassed = sliced.filter(item => isTransRelevant(item));
        const keywordFailed = sliced.filter(item => !isTransRelevant(item));
        let aiPassed: typeof sliced = [];
        if (keywordFailed.length > 0) {
          const aiResults = await aiFilterTransRelevant(keywordFailed).catch(err => {
            console.warn('[digest] ai filter error, dropping failed items:', (err as Error).message);
            return keywordFailed.map(() => false);
          });
          aiPassed = keywordFailed.filter((_, i) => aiResults[i]);
        }
        filteredSliced = [...keywordPassed, ...aiPassed];
      }
      // Bias scoring — await with 20s hard cap so Lambda doesn't exit early
      const biasTargets = filteredSliced.filter(item => item.link);
      if (biasTargets.length > 0) {
        await Promise.race([
          Promise.allSettled(biasTargets.map(item => scoreAndIngestBias(item))),
          new Promise<void>(resolve => setTimeout(resolve, 20_000)),
        ]);
      }
      categories[category] = {
        items: filteredSliced.map(item => {
          const hash = item.titleHash!;
          const sourceCount = corroborationMap.get(hash)?.size ?? 1;
          const stale = storyTracks.get(hash);
          // Merge stale state + this cycle's HINCRBY to get the current mentionCount.
          // New stories (stale = undefined) start at mentionCount=1 this cycle.
          const mentionCount = stale ? stale.mentionCount + 1 : 1;
          const firstSeen = stale?.firstSeen ?? now;
          const merged: StoryTrack = {
            firstSeen,
            lastSeen: now,
            mentionCount,
            sourceCount,
            currentScore: stale?.currentScore ?? 0,
            peakScore: stale?.peakScore ?? 0,
          };
          const storyMeta: { firstSeen: number; mentionCount: number; sourceCount: number; phase: string } = {
            firstSeen,
            mentionCount,
            sourceCount,
            phase: derivePhase(merged),
          };
          return toProtoItem(item, storyMeta);
        }),
      };
    }

    return {
      categories,
      feedStatuses,
      generatedAt: new Date().toISOString(),
    };
  } finally {
    clearTimeout(deadlineTimeout);
  }
}


const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const VALID_VARIANTS_SET = new Set(['full', 'tech', 'finance', 'happy', 'commodity', 'trans']);
const fallbackCache2 = new Map<string, { data: unknown; ts: number }>();

export const handler = async (event: { queryStringParameters?: Record<string, string>; requestContext?: { http?: { method?: string } } }) => {
  if (event.requestContext?.http?.method === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }
  const variant = VALID_VARIANTS_SET.has(event.queryStringParameters?.variant ?? '') ? (event.queryStringParameters?.variant ?? 'trans') : 'trans';
  const lang = event.queryStringParameters?.lang ?? 'en';
  const ctx = { request: {} };
  try {
    const result = await listFeedDigest(ctx as any, { variant, lang });
    if (fallbackCache2.size > 50) fallbackCache2.clear();
    fallbackCache2.set(`${variant}:${lang}`, { data: result, ts: Date.now() });
    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=60' },
      body: JSON.stringify(result),
    };
  } catch (err) {
    console.error('[news-digest] error:', err);
    await pushover({
      token: process.env.PUSHOVER_TOKEN,
      user:  process.env.PUSHOVER_USER,
      title: '🚨 TransMonitor: News Digest Error',
      message: `news-digest handler failed: ${(err as Error).message ?? err}`,
      priority: 1,
    });
    const fallback = fallbackCache2.get(`${variant}:${lang}`)?.data ?? { categories: {}, feedStatuses: {}, generatedAt: new Date().toISOString() };
    return { statusCode: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(fallback) };
  }
};

// ─── Media bias scoring ───────────────────────────────────────────────────────
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { createClient as createRedisClient } from 'redis';

const BIAS_SOURCE_REGISTRY = new Set([
  'dailymail.co.uk','telegraph.co.uk','thesun.co.uk','spectator.co.uk',
  'gbnews.com','talk.tv','thetimes.co.uk','express.co.uk','theguardian.com',
  'independent.co.uk','mirror.co.uk','inews.co.uk','bbc.co.uk','channel4.com',
  'itv.com','sky.com','metro.co.uk','huffingtonpost.co.uk','vice.com',
  'pinknews.co.uk','attitude.co.uk','divamag.co.uk','transactual.org.uk','stonewall.org.uk',
]);

const BIAS_EDITORIAL: Record<string, string> = {
  // UK press
  'dailymail.co.uk':'hostile','telegraph.co.uk':'hostile','thesun.co.uk':'hostile',
  'spectator.co.uk':'hostile','gbnews.com':'hostile','talk.tv':'hostile',
  'thetimes.co.uk':'hostile',
  'express.co.uk':'negative','theguardian.com':'negative','bbc.co.uk':'negative',
  'itv.com':'negative',
  'independent.co.uk':'neutral','mirror.co.uk':'neutral','inews.co.uk':'neutral',
  'sky.com':'neutral','metro.co.uk':'neutral',
  'channel4.com':'positive','huffingtonpost.co.uk':'positive','vice.com':'positive',
  // LGBTQ+ and trans-led media
  'pinknews.co.uk':'supportive','attitude.co.uk':'supportive','divamag.co.uk':'supportive',
  'them.us':'supportive','transvitae.com':'supportive','transgenderfeed.com':'supportive',
  'translash.org':'supportive','erininthemorning.com':'supportive','assignedmedia.org':'supportive',
  // Advocacy orgs
  'transactual.org.uk':'supportive','stonewall.org.uk':'supportive','transequality.org':'supportive',
  'transgenderlawcenter.org':'supportive','glaad.org':'supportive','tgeu.org':'supportive',
  'gate.ngo':'supportive',
};

const SOURCE_NAMES: Record<string, string> = {
  'dailymail.co.uk':'The Daily Mail','telegraph.co.uk':'The Daily Telegraph',
  'thesun.co.uk':'The Sun','spectator.co.uk':'The Spectator','gbnews.com':'GB News',
  'talk.tv':'TalkTV','thetimes.co.uk':'The Times','express.co.uk':'Daily Express',
  'theguardian.com':'The Guardian','independent.co.uk':'The Independent',
  'mirror.co.uk':'The Mirror','inews.co.uk':'The i','bbc.co.uk':'BBC News',
  'channel4.com':'Channel 4 News','itv.com':'ITV News','sky.com':'Sky News',
  'metro.co.uk':'Metro','huffingtonpost.co.uk':'HuffPost UK','vice.com':'Vice UK',
  'pinknews.co.uk':'Pink News','attitude.co.uk':'Attitude','divamag.co.uk':'DIVA Magazine',
  'transactual.org.uk':'TransActual','stonewall.org.uk':'Stonewall',
  'transvitae.com':'TransVitae','transgenderfeed.com':'Transgender Feed','translash.org':'TransLash',
  'erininthemorning.com':'Erin in the Morning','assignedmedia.org':'Assigned Media',
  'transequality.org':'Trans Equality','transgenderlawcenter.org':'Trans Law Center',
  'glaad.org':'GLAAD','them.us':'Them','tgeu.org':'TGEU','gate.ngo':'GATE Global',
};

const BIAS_SOURCE_NAME_MAP: Record<string, string> = {
  'BBC News': 'bbc.co.uk', 'BBC Trans Coverage': 'bbc.co.uk',
  'The Guardian': 'theguardian.com', 'Guardian Trans': 'theguardian.com',
  'The Independent': 'independent.co.uk',
  'Sky News': 'sky.com',
  'Channel 4 News': 'channel4.com',
  'The Times': 'thetimes.co.uk', 'Times Trans': 'thetimes.co.uk',
  'Daily Mail': 'dailymail.co.uk', 'Mail Trans': 'dailymail.co.uk',
  'The Telegraph': 'telegraph.co.uk',
  'The Sun': 'thesun.co.uk',
  'GB News': 'gbnews.com',
  'Pink News': 'pinknews.co.uk', 'PinkNews': 'pinknews.co.uk',
  'The Mirror': 'mirror.co.uk', 'Daily Mirror': 'mirror.co.uk',
  'Metro': 'metro.co.uk', 'Metro Trans': 'metro.co.uk',
  'The Spectator': 'spectator.co.uk',
  'ITV News': 'itv.com',
  'The Times Trans': 'thetimes.co.uk',
  'The Telegraph Trans': 'telegraph.co.uk',
  'Daily Express': 'express.co.uk',
  'The i': 'inews.co.uk',
  'HuffPost UK': 'huffingtonpost.co.uk',
  'TalkTV': 'talk.tv',
  'TransVitae': 'transvitae.com',
  'Transgender Feed': 'transgenderfeed.com',
  'TransLash': 'translash.org',
  'Daily Mail Search': 'dailymail.co.uk',
  'The Sun Search': 'thesun.co.uk',
  'The Spectator Search': 'spectator.co.uk',
  'TalkTV Search': 'talk.tv',
  'Daily Express Search': 'express.co.uk',
  'The i Search': 'inews.co.uk',
  'HuffPost UK Search': 'huffingtonpost.co.uk',
  'Channel 4 News Search': 'channel4.com',
  'Assigned Media Search': 'assignedmedia.org',
  'Attitude Search': 'attitude.co.uk',
  'DIVA Magazine Search': 'divamag.co.uk',
  'Erin Search': 'erininthemorning.com',
  'GATE Search': 'gate.ngo',
  'GLAAD Search': 'glaad.org',
  'Stonewall Search': 'stonewall.org.uk',
  'Trans Equality Search': 'transequality.org',
  'Trans Law Center Search': 'transgenderlawcenter.org',
  'TransActual Search': 'transactual.org.uk',
  'TransLash Search': 'translash.org',
  'Vice UK Search': 'vice.com',
  'Assigned Media': 'assignedmedia.org',
  'Trans Equality': 'transequality.org',
  'Trans Law Center': 'transgenderlawcenter.org',
  'GLAAD': 'glaad.org',
  'Them': 'them.us',
  'TransActual UK': 'transactual.org.uk',
  'TGEU News': 'tgeu.org',
  'GATE Global': 'gate.ngo',
  'Guardian Transgender': 'theguardian.com',
  'Independent Trans': 'independent.co.uk',
};

function extractBiasDomain(url: string, sourceName?: string): string | null {
  // Try source name map first (handles Google News redirects)
  if (sourceName && BIAS_SOURCE_NAME_MAP[sourceName]) {
    return BIAS_SOURCE_NAME_MAP[sourceName];
  }
  // Fall back to URL parsing
  try {
    const h = new URL(url).hostname.replace(/^www\./, '');
    for (const k of BIAS_SOURCE_REGISTRY) {
      if (h === k || h.endsWith('.' + k)) return k;
    }
    return null;
  } catch { return null; }
}

function biasScoreToLabel(score: number): string {
  if (score <= 20) return 'hostile';
  if (score <= 40) return 'negative';
  if (score <= 60) return 'neutral';
  if (score <= 80) return 'positive';
  return 'supportive';
}

function simpleHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(16).padStart(8, '0');
}

async function scoreAndIngestBias(item: { link: string; title: string; source: string; publishedAt: number }): Promise<void> {
  const url = item.link ?? '';
  const domain = extractBiasDomain(url, item.source);
  if (!domain) return;
  // Skip empty/placeholder titles — just the source name or too short to score meaningfully
  const titleClean = item.title.trim();
  if (titleClean.length < 20) return;
  if (titleClean === item.source || titleClean === `- ${item.source}`) return;
  if (/^-\s*$/.test(titleClean)) return;

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return;

  try {
    // Score via Bedrock
    const bedrock = new BedrockRuntimeClient({ region: 'eu-west-1' });
    const editorialStance = BIAS_EDITORIAL[domain] ?? 'neutral';
    const prompt = `You are a media bias analyst specialising in UK trans rights coverage.

STEP 1 — Relevance:
Mark relevant=true if the article is about transgender or non-binary people, gender identity, trans rights/policy, gender-critical activism, or directly related issues (Cass Review, GRA, puberty blockers, gender clinics, trans athletes, conversion therapy, EHRC trans guidance, single-sex spaces, gender recognition).

If the HEADLINE explicitly mentions "trans", "transgender", "non-binary", "gender identity", "gender-critical", or any of the above topics → relevant=true.

Mark relevant=false ONLY if there is no trans/gender content at all (general entertainment, celebrity gossip without trans angle, general politics/sport, LGB-only coverage with no trans dimension).

When in doubt, mark relevant=true.

STEP 2 — Bias scoring (only if relevant=true):
Score how THIS OUTLET frames the subject — not the subject matter itself.
This article is from a source with an editorial stance of "${editorialStance}" toward trans issues.
A supportive outlet reporting on hostile news should still score highly if their framing is fair, accurate, and does not amplify the hostile position uncritically.
A hostile outlet publishing a positive story should score lower if the broader framing remains dismissive.

0-20  = hostile    (misgendering, deadnaming, "groomer" framing, biological essentialism used to deny rights)
21-40 = negative   (sceptical framing, "debate" language, gender-critical voices given primary platform)
41-60 = neutral    (factual reporting, balanced, no strong framing)
61-80 = positive   (inclusive language, trans voices quoted, affirming framing)
81-100 = supportive (trans-led perspective, advocacy-adjacent, explicitly affirmative)

Title: ${item.title}

Respond ONLY with valid JSON, no markdown:
{"relevant": true|false, "score": <integer 0-100 if relevant else null>, "reason": "<one sentence max 20 words>"}`;

    const bedrockResult = await Promise.race([
      bedrock.send(new InvokeModelCommand({
        modelId: 'eu.anthropic.claude-haiku-4-5-20251001-v1:0',
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 120,
          messages: [{ role: 'user', content: prompt }],
        }),
      })),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('bedrock_timeout')), 10_000)),
    ]);

    const raw = JSON.parse(new TextDecoder().decode((bedrockResult as any).body));
    const rawText = (raw.content?.[0]?.text ?? '').trim().replace(/^```json\s*/,'').replace(/```\s*$/,'').trim();
    const parsed = JSON.parse(rawText);
    const score = Math.max(0, Math.min(100, Math.round(parsed.score)));
    const label = biasScoreToLabel(score);
    const reason = parsed.reason ?? '';

    // Ingest into Redis
    const redis = createRedisClient({ url: redisUrl });
    await redis.connect();

    // Submit to Internet Archive — fire request but don't block on response
    fetch(`https://web.archive.org/save/${encodeURIComponent(url)}`, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(3000),
    }).catch(() => {});

    const archiveUrl = `https://web.archive.org/web/*/${url}`;

    const record = JSON.stringify({
      id: simpleHash(url),
      url,
      archiveUrl,
      title: item.title,
      publishedAt: new Date(item.publishedAt).toISOString(),
      domain,
      score,
      label,
      reason,
      scoredAt: new Date().toISOString(),
    });

    const articlesKey = `media:source:${domain}:articles`;
    const metaKey     = `media:source:${domain}:meta`;
    const dedupKey    = `media:dedup:${simpleHash(url)}`;

    // Skip if Bedrock flagged article as not trans-related
    if (parsed.relevant === false) { await redis.disconnect(); return; }
    // Skip if already scored this article
    const alreadyScored = await redis.get(dedupKey);
    if (alreadyScored) { await redis.disconnect(); return; }

    await redis.set(dedupKey, '1', { EX: 60 * 60 * 24 * 7 }); // 7-day dedup window
    await redis.lPush(articlesKey, record);
    await redis.lTrim(articlesKey, 0, 99);

    const meta = await redis.hGetAll(metaKey);
    let prevTotal = parseInt(meta?.totalScore  ?? '0', 10);
    let prevCount = parseInt(meta?.articleCount ?? '0', 10);
    // Reset corrupted meta: totalScore=0 with high articleCount means pre-fix bad state
    if (prevCount > 5 && prevTotal === 0) { prevTotal = 0; prevCount = 0; }
    const newCount  = prevCount + 1;
    const newTotal  = prevTotal + score;
    const avgScore  = Math.round(newTotal / newCount);

    await redis.hSet(metaKey, {
      name:          SOURCE_NAMES[domain] ?? domain,
      domain,
      editorialBias: BIAS_EDITORIAL[domain] ?? 'neutral',
      articleCount:  String(newCount),
      totalScore:    String(newTotal),
      avgScore:      String(avgScore),
      avgLabel:      biasScoreToLabel(avgScore),
      lastSeenAt:    new Date(item.publishedAt).toISOString(),
      updatedAt:     new Date().toISOString(),
    });

    await redis.sAdd('media:bias:index', domain);
    await redis.disconnect();

  } catch (err) {
    console.warn('[bias] score/ingest failed for', domain, (err as Error).message);
  }
}
