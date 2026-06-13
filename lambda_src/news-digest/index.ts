
import { createClient as createRedisClient } from 'redis';
import { cachedFetchJson, getCachedJsonBatch, runRedisPipeline } from './_redis.js';
import { pushover } from './pushover.js';
import { sha256Hex } from './_hash.js';
import { VARIANT_FEEDS, INTEL_SOURCES, type ServerFeed } from './_feeds.js';
import { classifyByKeyword, type ThreatLevel } from './_classifier.js';
import { getSourceTier } from './_source-tiers.js';
import { STORY_TRACK_KEY, STORY_SOURCES_KEY, STORY_PEAK_KEY, DIGEST_ACCUMULATOR_KEY, STORY_TTL, STORY_TRACK_KEY_PREFIX, DIGEST_ACCUMULATOR_TTL } from './_cache-keys.js';
import { isTransRelevant } from './_trans-filter.js';
import { aiFilterTransRelevant } from './_trans-ai-filter.js';
import {
  extractBiasDomain,
  isGoogleNewsUrl,
  canResolveBiasDomain,
} from '../_shared/media-bias-domains.js';
import {
  BIAS_QUEUE_KEY,
  BIAS_QUEUE_MAX,
  type BiasQueueRef,
} from '../_shared/media-bias-queue.js';

const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const RSS_ACCEPT = 'application/rss+xml, application/xml, text/xml, */*';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const markNoCacheResponse = (_req: unknown) => {};
const getRelayBaseUrl = () => null;
const getRelayHeaders = (h: Record<string, string>) => h;

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
  summary?: string;
  scanAllWithBedrock?: boolean;
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

const LIVE_FEED_MAX_AGE_MS = 45 * 24 * 60 * 60 * 1000;
const FUTURE_SKEW_MS = 6 * 60 * 60 * 1000;

function isBackfillSource(source: string): boolean {
  return /\bbackfill\b/i.test(source);
}

function normaliseDedupeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+[-–—]\s+[^-–—|]+$/g, '')
    .replace(/\([^)]*(exclusive|video|watch)[^)]*\)/gi, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function liveItemDedupeKey(item: ParsedItem): string {
  const link = String(item.link ?? '').trim().toLowerCase();

  // Google News RSS links can repeat the same underlying item under different
  // feed/source names, so title is the safer primary key for those.
  if (link.includes('news.google.com/rss/articles/')) {
    return `title:${normaliseDedupeText(item.title)}`;
  }

  return link
    ? `link:${link}`
    : `title:${normaliseDedupeText(item.title)}`;
}

function cleanLiveDigestItems(items: ParsedItem[]): ParsedItem[] {
  const now = Date.now();
  const seen = new Set<string>();

  return items
    .filter(item => {
      if (isBackfillSource(item.source)) return false;

      const publishedAt = Number(item.publishedAt);
      if (!Number.isFinite(publishedAt) || publishedAt <= 0) return false;
      if (publishedAt > now + FUTURE_SKEW_MS) return false;
      return publishedAt >= now - LIVE_FEED_MAX_AGE_MS;

      
    })
    .filter(item => {
      const key = liveItemDedupeKey(item);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

const HERO_CATEGORY_PRIORITY: Record<string, number> = {
  healthcare: 12,
  legal: 11,
  "uk-press": 10,
  mainstream: 9,
  international: 8,
  safety: 3,
  community: 2,
  wins: 1,
};

function heroScore(item: any, category: string): number {
  const base = Number(item.importanceScore ?? 0);
  const priority = HERO_CATEGORY_PRIORITY[category] ?? 0;

  // Do not let low/medium safety stories dominate the digest hero.
  if (category === "safety" && base < 35) return base - 20;

  return base + priority;
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

interface AbortSignal {
  addEventListener(type: string, listener: () => void, options?: { once?: boolean }): void;
  removeEventListener(type: string, listener: () => void): void;
  readonly aborted: boolean;
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

    const summary = (
      extractTag(block, 'description') ||
      extractTag(block, 'summary') ||
      extractTag(block, 'content:encoded') ||
      ''
    ).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1000);

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
      source: inferDigestDisplaySource(feed.name, link, title),
      title: isGoogleNewsUrlForDisplay(link) ? cleanGoogleNewsTitleForDisplay(title) : title,
      summary,
      link,
      publishedAt,
      isAlert,
      level: threat.level,
      category: threat.category,
      confidence: threat.confidence,
      classSource: 'keyword',
      scanAllWithBedrock: feed.scanAllWithBedrock === true,
      importanceScore: 0,
      corroborationCount: 1,
      lang: feed.lang ?? 'en',
    });
  }

  return items.length > 0 ? items : null;
}

const TAG_REGEX_CACHE = new Map<string, { cdata: RegExp; plain: RegExp }>();
const KNOWN_TAGS = ['title', 'link', 'pubDate', 'published', 'updated', 'description', 'summary', 'content:encoded'] as const;
for (const tag of KNOWN_TAGS) {
  TAG_REGEX_CACHE.set(tag, {
    // Safer regexes with specific character classes to avoid catastrophic backtracking.
    cdata: new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`, 'i'),
    plain: new RegExp(`<${tag}[^>]*>([^<]*)<\\/${tag}>`, 'i'),
  });
}

function extractTag(xml: string, tag: string): string {
  const cached = TAG_REGEX_CACHE.get(tag);
  // Fallback to cached or new regex (though all expected tags are in cache)
  const cdataRe = cached?.cdata ?? new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`, 'i');
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
    source: inferDigestDisplaySource(item.source, item.link, item.title),
    title: isGoogleNewsUrlForDisplay(item.link) ? cleanGoogleNewsTitleForDisplay(item.title) : item.title,
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

interface DigestResult {
  hero?: unknown;
  categories: Record<string, { items: unknown[] }>;
  feedStatuses: Record<string, string>;
  generatedAt: string;
}

export async function listFeedDigest(
  ctx: any,
  req: { variant: string; lang: string; refresh?: boolean },
): Promise<DigestResult> {
  const variant = VALID_VARIANTS.has(req.variant) ? req.variant : 'full';
  const lang = req.lang || 'en';
  const refresh = req.refresh === true;

  const digestCacheKey = `news:digest:v1:${variant}:${lang}`;
  const fallbackKey = `${variant}:${lang}`;

  const empty = (): DigestResult => ({ categories: {}, feedStatuses: {}, generatedAt: new Date().toISOString() });

  try {
    // cachedFetchJson coalesces concurrent cold-path calls: concurrent requests
    // for the same key share a single buildDigest() run instead of fanning out
    // across all RSS feeds. Returning null skips the Redis write and caches a
    // neg-sentinel (120s) to absorb the request storm during degraded periods.
    const buildFreshDigest = async (): Promise<DigestResult | null> => {
      const result = await buildDigest(variant, lang) as DigestResult;
      const totalItems = Object.values(result.categories).reduce((sum, b) => sum + b.items.length, 0);
      return totalItems > 0 ? result : null;
    };

    const fresh = refresh
      ? await buildFreshDigest()
      : await cachedFetchJson<DigestResult>(
          digestCacheKey,
          900,
          buildFreshDigest,
        );

    if (fresh === null) {
      markNoCacheResponse(ctx.request);
      return fallbackDigestCache.get(fallbackKey)?.data as DigestResult ?? empty();
    }

    if (fallbackDigestCache.size > 50) fallbackDigestCache.clear();
    fallbackDigestCache.set(fallbackKey, { data: fresh, ts: Date.now() });
    return fresh;
  } catch {
    markNoCacheResponse(ctx.request);
    return fallbackDigestCache.get(fallbackKey)?.data as DigestResult ?? empty();
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

async function buildDigest(variant: string, lang: string): Promise<DigestResult> {
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
    let allItems = [...results.values()].flat();

    // Direct general RSS feeds can contain relevant articles whose titles do not
    // include obvious trans keywords. For feeds marked scanAllWithBedrock, run an
    // early Bedrock/Ollama relevance pass before clustering/slicing drops them.
    if (variant === 'trans') {
      const scanAllCandidates = allItems.filter(item =>
        item.scanAllWithBedrock === true && !isTransRelevant(item),
      );

      if (scanAllCandidates.length > 0) {
        const maxScanAll = Number(process.env.TRANS_RELEVANCE_SCAN_MAX ?? '80');
        const limited = scanAllCandidates.slice(0, maxScanAll);

        console.log(
          `[digest] scan-all Bedrock relevance candidates=${scanAllCandidates.length} limited=${limited.length}`,
        );

        const aiResults = await aiFilterTransRelevant(limited).catch(err => {
          console.warn('[digest] scan-all Bedrock relevance filter failed:', (err as Error).message);
          return limited.map(() => false);
        });

        const aiKeep = new Set(limited.filter((_, i) => aiResults[i]));

        console.log(
          `[digest] scan-all Bedrock relevance passed=${aiKeep.size} rejected=${limited.length - aiKeep.size}`,
        );

        // Promote Bedrock-approved scan-all items before importance scoring.
        // Otherwise general-RSS articles can survive relevance filtering but still
        // lose the category slice because their original keyword classification was weak.
        for (const item of aiKeep) {
          item.classSource = 'llm';
          item.confidence = Math.max(item.confidence, 0.9);
          if (item.level === 'info' || item.level === 'low') {
            item.level = 'medium';
            item.isAlert = false;
          }
          if (!item.category || item.category === 'general') {
            item.category = 'trans';
          }
        }

        for (const [category, items] of results) {
          results.set(
            category,
            items.filter(item =>
              item.scanAllWithBedrock !== true ||
              isTransRelevant(item) ||
              aiKeep.has(item),
            ),
          );
        }

        allItems = [...results.values()].flat();
      }
    }

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
      const dedupedItems = cleanLiveDigestItems(
        items.filter(item => winningHashes.has(item.titleHash!))
      );
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

    // Collect direct RSS media-bias targets (Attitude, DIVA, Vice, Daily Mail, Express, The i, etc.)
    // and enqueue them for the scheduled consumer. No inline Bedrock scoring on the read path.
    const seenGlobalBiasDomains = new Set<string>();
    const directBiasTargets = allItems
      .filter(item => item.link && (item.scanAllWithBedrock === true || isGoogleNewsUrl(item.link)) && canResolveBiasDomain(item))
      .filter(item => isTransRelevant({ title: `${item.title} ${item.summary ?? ''}` }))
      .sort((a, b) => b.importanceScore - a.importanceScore || b.publishedAt - a.publishedAt)
      .filter(item => {
        const domain = extractBiasDomain(item.link, item.source, item.title);
        if (!domain || seenGlobalBiasDomains.has(domain)) return false;
        seenGlobalBiasDomains.add(domain);
        return true;
      });

    const biasTargetsToEnqueue = [...directBiasTargets];

    // Trans-relevance filtering (two-phase, single batched AI call).
    //
    // Phase 1 here: across ALL filtered categories, run the cheap synchronous
    // keyword filter and collect every keyword-FAILED item into one list. Then
    // make a SINGLE batched aiFilterTransRelevant call (chunked to respect the
    // model's response token cap) to semantically rescue dog-whistle / hostile
    // coverage that doesn't use obvious trans keywords. This replaces the old
    // per-category, 8-item-capped, wall-clock-budgeted approach that pre-expired
    // its deadline before any AI call ran and silently dropped most candidates.
    //
    // aiFilterTransRelevant is one Bedrock round-trip per batch (~1-2s for ~40
    // titles), so a single global call comfortably fits the Lambda timeout —
    // no per-category budget needed.
    const TRANS_FILTERED_CATEGORIES = new Set(['community', 'legal', 'mainstream', 'safety', 'international', 'uk-press', 'wins']);
    const AI_FILTER_CHUNK = Number(process.env.AI_FILTER_CHUNK ?? '40');

    // Precompute keyword pass/fail per category so we don't run isTransRelevant twice.
    const keywordPassedByCategory = new Map<string, ParsedItem[]>();
    const keywordFailedByCategory = new Map<string, ParsedItem[]>();
    const allKeywordFailed: ParsedItem[] = [];

    for (const [category, sliced] of slicedByCategory) {
      if (variant !== 'trans' || !TRANS_FILTERED_CATEGORIES.has(category)) continue;
      const passed = sliced.filter(item => isTransRelevant(item));
      const failed = sliced.filter(item => !isTransRelevant(item));
      keywordPassedByCategory.set(category, passed);
      keywordFailedByCategory.set(category, failed);
      for (const item of failed) allKeywordFailed.push(item);
    }

    // One batched AI rescue pass over ALL keyword-failed items, chunked so the
    // JSON boolean-array response cannot exceed the model's max_tokens.
    const aiRescued = new Set<ParsedItem>();
    if (allKeywordFailed.length > 0) {
      console.log(`[digest] ai rescue: ${allKeywordFailed.length} keyword-failed items across categories`);
      for (let i = 0; i < allKeywordFailed.length; i += AI_FILTER_CHUNK) {
        const chunk = allKeywordFailed.slice(i, i + AI_FILTER_CHUNK);
        const aiResults = await aiFilterTransRelevant(chunk).catch(err => {
          console.warn('[digest] ai rescue chunk failed, dropping items:', (err as Error).message);
          return chunk.map(() => false);
        });
        chunk.forEach((item, j) => { if (aiResults[j]) aiRescued.add(item); });
      }
      console.log(`[digest] ai rescue passed=${aiRescued.size} rejected=${allKeywordFailed.length - aiRescued.size}`);
    }

    for (const [category, sliced] of slicedByCategory) {
      // Phase 2: assemble this category's filtered items from the precomputed
      // keyword-passed set plus any AI-rescued keyword-failed items.
      let filteredSliced = sliced;
      if (variant === 'trans' && TRANS_FILTERED_CATEGORIES.has(category)) {
        const keywordPassed = keywordPassedByCategory.get(category) ?? [];
        const keywordFailed = keywordFailedByCategory.get(category) ?? [];
        const aiPassed = keywordFailed.filter(item => aiRescued.has(item));
        filteredSliced = [...keywordPassed, ...aiPassed];
      }
      // Collect this category's resolvable bias targets for out-of-band enqueueing.
      // No inline Bedrock scoring; the scheduled consumer scores from the queue.
      const categoryBiasTargets = filteredSliced
        .filter(item => item.link && (item.scanAllWithBedrock === true || isGoogleNewsUrl(item.link)) && canResolveBiasDomain(item));
      for (const item of categoryBiasTargets) biasTargetsToEnqueue.push(item);

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

    console.log('[digest] finished category loop, building hero/response');

    // PR3: enqueue all collected bias targets in one batch for the scheduled
    // consumer. Non-blocking to the response — failures are swallowed inside.
    await enqueueBiasRefs(biasTargetsToEnqueue).catch((err: unknown) =>
      console.warn('[media-bias] digest enqueue batch failed:', err),
    );

    const hero = [...slicedByCategory.entries()]
      .flatMap(([category, items]) => items.map(item => ({ item, category })))
      .map(({ item, category }) => ({ item, category, score: heroScore(item, category) }))
      .sort((a, b) =>
        b.score - a.score ||
        Number(b.item.publishedAt ?? 0) - Number(a.item.publishedAt ?? 0)
      )[0];

    return {
      hero: hero ? toProtoItem(hero.item, {
        firstSeen: storyTracks.get(hero.item.titleHash!)?.firstSeen ?? now,
        mentionCount: (storyTracks.get(hero.item.titleHash!)?.mentionCount ?? 0) + 1,
        sourceCount: corroborationMap.get(hero.item.titleHash!)?.size ?? 1,
        phase: derivePhase({
          firstSeen: storyTracks.get(hero.item.titleHash!)?.firstSeen ?? now,
          lastSeen: now,
          mentionCount: (storyTracks.get(hero.item.titleHash!)?.mentionCount ?? 0) + 1,
          sourceCount: corroborationMap.get(hero.item.titleHash!)?.size ?? 1,
          currentScore: storyTracks.get(hero.item.titleHash!)?.currentScore ?? 0,
          peakScore: storyTracks.get(hero.item.titleHash!)?.peakScore ?? 0,
        }),
      }) : undefined,
      categories,
      feedStatuses,
      generatedAt: new Date().toISOString(),
    };
  } finally {
    clearTimeout(deadlineTimeout);
  }
}


const VALID_VARIANTS_SET = new Set(['full', 'tech', 'finance', 'happy', 'commodity', 'trans']);
const fallbackCache2 = new Map<string, { data: unknown; ts: number }>();

export const handler = async (event: { queryStringParameters?: Record<string, string>; requestContext?: { http?: { method?: string } } }) => {
  if (event.requestContext?.http?.method === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }
  const variant = VALID_VARIANTS_SET.has(event.queryStringParameters?.variant ?? '') ? event.queryStringParameters?.variant ?? 'trans' : 'trans';
  const lang = event.queryStringParameters?.lang ?? 'en';
  const refresh = ['1', 'true', 'yes'].includes((event.queryStringParameters?.refresh ?? '').toLowerCase())
    || ['1', 'true', 'yes'].includes((event.queryStringParameters?.force ?? '').toLowerCase())
    || ['1', 'true', 'yes'].includes((event.queryStringParameters?.bypassCache ?? '').toLowerCase());
  const ctx = { request: {} };
  try {
    const result = await listFeedDigest(ctx as any, { variant, lang, refresh });
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





function isGoogleNewsUrlForDisplay(url: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase().replace(/^www\./, '').replace(/^amp\./, '').replace(/^m\./, '');
    return h === 'news.google.com' || h.endsWith('.google.com');
  } catch {
    return false;
  }
}

function extractPublisherSuffixForDisplay(title: string): string | null {
  // Google News RSS titles commonly look like:
  //   "Story headline - Publisher Name"
  const match = title.match(/\s[-–—]\s([^—–-]{2,100})\s*$/);
  if (!match) return null;

  const publisher = match[1].trim();

  if (!publisher) return null;
  if (/^https?:\/\//i.test(publisher)) return null;
  if (publisher.length < 2 || publisher.length > 100) return null;

  return publisher;
}

function cleanGoogleNewsTitleForDisplay(title: string): string {
  return title.replace(/\s[-–—]\s([^—–-]{2,100})\s*$/, '').trim();
}

function inferDigestDisplaySource(feedSource: string, link: string, title: string): string {
  if (!isGoogleNewsUrlForDisplay(link)) return feedSource;

  const publisher = extractPublisherSuffixForDisplay(title);
  return publisher ?? feedSource;
}










async function enqueueBiasRefs(
  items: Array<{ link: string; title: string; source: string; publishedAt: number; summary?: string }>,
): Promise<number> {
  // PR3: the read path no longer scores inline. It enqueues resolvable, trans-relevant
  // refs onto media:bias:queue for the media-bias scheduled consumer to score out-of-band.
  // Dedup against domains and against the queue cap; the consumer applies the 7-day
  // media:dedup window, so cheap over-enqueueing here is harmless.
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return 0;

  const seenDomains = new Set<string>();
  const refs: string[] = [];

  for (const item of items) {
    const url = item.link ?? '';
    if (!url) continue;

    const titleClean = (item.title ?? '').trim();
    if (titleClean.length < 20 || titleClean === item.source) continue;

    const domain = extractBiasDomain(url, item.source, item.title);
    if (!domain || seenDomains.has(domain)) continue;
    seenDomains.add(domain);

    const ref: BiasQueueRef = {
      url,
      title: item.title,
      source: item.source,
      publishedAt: item.publishedAt,
      summary: item.summary,
    };
    refs.push(JSON.stringify(ref));
  }

  if (refs.length === 0) return 0;

  const redis = createRedisClient({ url: redisUrl });
  try {
    await redis.connect();
    await redis.rPush(BIAS_QUEUE_KEY, refs);
    await redis.lTrim(BIAS_QUEUE_KEY, -BIAS_QUEUE_MAX, -1);
    console.log(`[media-bias] enqueued ${refs.length} bias refs from digest`);
  } catch (err) {
    console.warn('[media-bias] digest enqueue failed (non-fatal):', (err as Error).message);
  } finally {
    await redis.disconnect().catch(() => {});
  }

  return refs.length;
}
