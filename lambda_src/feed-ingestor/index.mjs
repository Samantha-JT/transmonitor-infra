import { createClient } from "redis";
import { pushover } from "./pushover.mjs";;
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { XMLParser } from "fast-xml-parser";
import { canResolveBiasDomain } from "../_shared/media-bias-domains.js";
import { BIAS_QUEUE_KEY, BIAS_QUEUE_MAX } from "../_shared/media-bias-queue.js";

const s3 = new S3Client({ region: process.env.AWS_REGION });
let redisClient = null;

async function getRedis() {
  if (redisClient && redisClient.isOpen) return redisClient;
  redisClient = createClient({
    url: process.env.REDIS_URL,
    socket: { tls: true },
  });
  await redisClient.connect();
  return redisClient;
}

const gn = (q) => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
const gnGB = (q) => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-GB&gl=GB&ceid=GB:en`;

const FEEDS = {
  legal: [
    { name: "Erin in the Morning", url: "https://www.erininthemorning.com/feed" },
    // DISABLED 2026-06-07: persistent 404/403 in Lambda logs: { name: "Trans Legislation Tracker", url: "https://translegislation.com/rss.xml" },
    { name: "ACLU LGBT News", url: "https://www.aclu.org/news/by-issue/lgbtq-rights/feed" },
    { name: "US Trans Legislation", url: gn('("gender-affirming care ban" OR "trans bill" OR "bathroom bill","bathroom law" OR "drag ban") when:3d') },
    { name: "UK Trans Law", url: gnGB('("GRC" OR "Gender Recognition Act" OR "Cass Review" OR "Equality Act") UK when:3d') },
    { name: "EU Gender Recognition", url: gn('("gender self-determination" OR "Ley Trans" OR "Selbstbestimmungsgesetz") when:7d') },
  ],
  healthcare: [
    { name: "Gender Analysis", url: "https://genderanalysis.net/feed/", timeoutMs: 15000 },
    { name: "Trans Healthcare Access", url: gn('("transgender" OR "trans rights") ("gender-affirming care" OR "puberty blockers" OR "hormone therapy" OR "HRT") when:3d') },
    { name: "Cass Review Coverage", url: gn('("Cass Review" OR "Tavistock clinic") when:7d') },
    { name: "Puberty Blocker Rulings", url: gn('"puberty blockers" (court OR ruling OR ban) when:7d') },
  ],
  community: [
    { name: "PinkNews", url: "https://www.thepinknews.com/feed/" },
    { name: "LGBTQ Nation", url: "https://www.lgbtqnation.com/feed/" },
    { name: "Them", url: "https://www.them.us/feed/rss" },
    { name: "Xtra Magazine", url: "https://xtramagazine.com/feed" },
    { name: "Autostraddle", url: "https://www.autostraddle.com/feed/" },
    { name: "The 19th", url: "https://19thnews.org/feed/" },
  ],
  safety: [
    { name: "Trans Violence News", url: gn('("transgender" OR "trans woman" OR "trans man") ("hate crime" OR "attacked" OR "murdered" OR "killed") when:3d') },
    { name: "UK Trans Safety", url: gnGB('("transgender" OR "trans") ("hate crime" OR "attack" OR "violence") UK when:7d') },
    { name: "Trans Murder Monitoring", url: gn("site:transrespect.org when:30d") },
    { name: "HRC Violence Tracker", url: gn('site:hrc.org ("violence" OR "fatal" OR "transgender") when:30d') },
  ],
  "uk-press": [
    { name: "BBC News", url: gnGB('(transgender OR "trans rights" OR "Cass Review") site:bbc.co.uk when:3d') },
    { name: "The Guardian", url: gnGB('(transgender OR "trans rights" OR "gender recognition") site:theguardian.com when:3d') },
    { name: "The Independent", url: gnGB('(transgender OR "trans rights") site:independent.co.uk when:3d') },
    { name: "Sky News", url: gnGB('(transgender OR "trans rights") site:news.sky.com when:3d') },
    { name: "Channel 4 News", url: gnGB('(transgender OR "trans rights") site:channel4.com when:7d') },
  ],
  wins: [
    { name: "Trans Wins", url: gn('(transgender OR "trans rights") (wins OR victory OR "first trans" OR elected OR milestone OR landmark) when:7d') },
    { name: "Trans Legal Wins", url: gn('(transgender OR "trans rights") (court OR judge) (blocks OR overturns OR "upholds rights") when:7d') },
  ],
  mainstream: [
    { name: "Reuters LGBT", url: gn('site:reuters.com ("transgender" OR "gender-affirming care" OR "trans rights") when:3d') },
    { name: "Washington Post Trans", url: gn('site:washingtonpost.com ("transgender" OR "gender-affirming care ban" OR "trans bill") when:7d') },
    { name: "NYT Trans Coverage", url: gn('site:nytimes.com ("transgender" OR "gender-affirming care ban" OR "trans bill") when:7d') },
  ],
  international: [
    { name: "Reuters Trans Coverage", url: gn('site:reuters.com ("transgender" OR "trans rights" OR "nonbinary") when:7d') },
    { name: "LatAm Trans Rights", url: gn('("Ley de Identidad de Genero" OR "transgender rights") when:7d') },
    { name: "Asia-Pacific Trans News", url: gn('("transgender" OR "hijra") (Thailand OR Japan OR Korea OR India) when:7d') },
  ],
};

const SAFETY_KEYWORDS = ["murdered","killed","stabbed","shot","attacked","assault","hate crime","violence","fatal","death","tdor","trans day of remembrance"];
const RIGHTS_KEYWORDS = ["ban","banned","outlawed","criminalised","criminalized","bathroom bill","bathroom law","anti-trans","drag ban","gender ideology"];
const POSITIVE_KEYWORDS = ["victory","wins","elected","landmark","milestone","first trans","overturns","blocks ban","upholds","celebrates","representation","awarded"];

function classifyItem(title) {
  const t = title.toLowerCase();
  if (SAFETY_KEYWORDS.some(k => t.includes(k))) return "safety";
  if (RIGHTS_KEYWORDS.some(k => t.includes(k))) return "rights";
  if (POSITIVE_KEYWORDS.some(k => t.includes(k))) return "positive";
  return "general";
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  cdataPropName: "__cdata",
  trimValues: true,
});

function parseDate(str) {
  if (!str) return new Date();
  const d = new Date(str);
  return isNaN(d.getTime()) ? new Date() : d;
}

function extractItems(parsed) {
  const rssItems = parsed?.rss?.channel?.item;
  if (rssItems) return Array.isArray(rssItems) ? rssItems : [rssItems];
  const entries = parsed?.feed?.entry;
  if (entries) return Array.isArray(entries) ? entries : [entries];
  return [];
}

function itemToNewsItem(item, sourceName, isAtom) {
  const rawTitle = item.title?.__cdata ?? item.title ?? "";
  const title = String(rawTitle).trim();
  let link = "";
  if (isAtom) {
    const l = item.link;
    link = typeof l === "object" ? (l?.["@_href"] ?? "") : String(l ?? "");
  } else {
    link = String(item.link?.__cdata ?? item.link ?? "").trim();
  }
  const pubDateStr = isAtom ? (item.published ?? item.updated ?? "") : (item.pubDate ?? "");
  return {
    source: sourceName,
    title,
    link: link.trim(),
    pubDate: parseDate(pubDateStr).toISOString(),
    classification: classifyItem(title),
  };
}

async function fetchAndParseFeed(feed) {
  const controller = new AbortController();
  // Per-feed timeout override (feed.timeoutMs) falls back to the global default.
  // Used for feeds with large payloads whose parse time exceeds the default,
  // e.g. Gender Analysis publishes full article bodies in content:encoded.
  const timeoutMs = feed.timeoutMs ?? Number(process.env.FEED_TIMEOUT_MS ?? 5000);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(feed.url, {
      signal: controller.signal,
      headers: { "User-Agent": "TransMonitor/2.0 (+https://trans-news.com)" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const parsed = xmlParser.parse(text);
    const rawItems = extractItems(parsed);
    const isAtom = !parsed?.rss;
    return rawItems.slice(0, 5)
      .map(item => itemToNewsItem(item, feed.name, isAtom))
      .filter(item => item.title && item.link);
  } catch (e) {
    console.warn(`[ingestor] Failed ${feed.name}: ${e.message}`);
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

export const handler = async () => {
  const variant = process.env.VARIANT ?? "trans";
  const allFeeds = Object.values(FEEDS).flat();
  console.log(`feed-ingestor: fetching ${allFeeds.length} feeds`);

  const BATCH_SIZE = 8;
  const allItems = [];
  const feedStats = []; // { name, count } per feed, for visibility
  for (let i = 0; i < allFeeds.length; i += BATCH_SIZE) {
    const batch = allFeeds.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map(fetchAndParseFeed));
    results.forEach((items, j) => {
      feedStats.push({ name: batch[j].name, count: items.length });
      allItems.push(...items);
    });
  }

  // Per-feed visibility: log every feed's item count, and call out empties
  // explicitly so quiet-but-working feeds can be told apart from broken ones.
  const summary = feedStats
    .map(s => `${s.name}=${s.count}`)
    .join(", ");
  console.log(`feed-ingestor: per-feed counts: ${summary}`);
  const empties = feedStats.filter(s => s.count === 0).map(s => s.name);
  if (empties.length > 0) {
    console.warn(`feed-ingestor: ${empties.length} feed(s) returned 0 items: ${empties.join(", ")}`);
  }

  const seen = new Set();
  const deduped = allItems.filter(item => {
    if (!item.link || seen.has(item.link)) return false;
    seen.add(item.link);
    return true;
  });
  deduped.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

  const byCategory = {};
  for (const item of deduped) {
    if (!byCategory[item.classification]) byCategory[item.classification] = [];
    byCategory[item.classification].push(item);
  }

  const digest = {
    variant,
    timestamp: new Date().toISOString(),
    totalItems: deduped.length,
    items: deduped.slice(0, 200),
    byCategory,
    meta: { source: "feed-ingestor", version: "2.0.0", feedCount: allFeeds.length },
  };

  const key = `cache/${variant}/digest.json`;
  const body = JSON.stringify(digest);

  await s3.send(new PutObjectCommand({
    Bucket: process.env.DIGEST_BUCKET,
    Key: key,
    Body: body,
    ContentType: "application/json",
  }));
  console.log(`feed-ingestor: wrote ${deduped.length} items`);

  try {
    const redis = await getRedis();
    await redis.set(`digest:${variant}`, body, { EX: 1200 });
    console.log("feed-ingestor: Redis warmed");

    // ── Media-bias producer (PR2) ──────────────────────────────────────────
    // Enqueue refs for items whose domain resolves to a known bias source so the
    // media-bias lambda's scheduled consumer can score them out-of-band. Capped
    // so the list cannot grow unbounded if the consumer is down. Non-fatal.
    try {
      const refs = [];
      for (const item of deduped) {
        if (!item.link) continue;
        if (!canResolveBiasDomain({ link: item.link, title: item.title, source: item.source })) continue;
        refs.push(JSON.stringify({
          url: item.link,
          title: item.title,
          source: item.source,
          publishedAt: new Date(item.pubDate).getTime(),
        }));
      }
      if (refs.length > 0) {
        await redis.rPush(BIAS_QUEUE_KEY, refs);
        await redis.lTrim(BIAS_QUEUE_KEY, -BIAS_QUEUE_MAX, -1); // keep newest BIAS_QUEUE_MAX
        console.log(`feed-ingestor: enqueued ${refs.length} bias refs`);
      }
    } catch (e) {
      console.warn("feed-ingestor: bias enqueue failed (non-fatal):", e.message);
    }
  } catch (e) {
    console.warn("feed-ingestor: Redis failed (non-fatal):", e.message);
    await pushover({
      token: process.env.PUSHOVER_TOKEN,
      user:  process.env.PUSHOVER_USER,
      title: "⚠️ TransMonitor: Redis Warning",
      message: `Feed ingestor Redis cache failed: ${e.message}`,
      priority: 0,
    });
  }

  if (deduped.length === 0) {
    await pushover({
      token: process.env.PUSHOVER_TOKEN,
      user:  process.env.PUSHOVER_USER,
      title: "🚨 TransMonitor: Zero Items Ingested",
      message: `Feed ingestor returned 0 items for variant <b>${variant}</b>. Check feed sources.`,
      priority: 1,
    });
  } else if (deduped.length < 10) {
    await pushover({
      token: process.env.PUSHOVER_TOKEN,
      user:  process.env.PUSHOVER_USER,
      title: "⚠️ TransMonitor: Low Item Count",
      message: `Feed ingestor only got <b>${deduped.length} items</b> for variant ${variant}. Feeds may be degraded.`,
      priority: 0,
    });
  }

  return { statusCode: 200, body: `ok - ${deduped.length} items` };
};
