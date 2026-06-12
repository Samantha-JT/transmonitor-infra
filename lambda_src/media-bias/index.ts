import { createClient } from 'redis';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
};

const MAX_ARTICLES_PER_SOURCE = 100;
const BEDROCK_MODEL = 'eu.anthropic.claude-haiku-4-5-20251001-v1:0';
const BEDROCK_TIMEOUT_MS = 10_000;

const sourceArticlesKey = (domain: string) => `media:source:${domain}:articles`;
const sourceMetaKey    = (domain: string) => `media:source:${domain}:meta`;
const biasIndexKey     = () => `media:bias:index`;

export const SOURCE_REGISTRY: Record<string, { name: string; domain: string; editorialBias: string }> = {
  // UK press — hostile/right-wing
  'dailymail.co.uk':      { name: 'The Daily Mail',      domain: 'dailymail.co.uk',      editorialBias: 'hostile' },
  'telegraph.co.uk':      { name: 'The Daily Telegraph', domain: 'telegraph.co.uk',      editorialBias: 'hostile' },
  'thesun.co.uk':         { name: 'The Sun',             domain: 'thesun.co.uk',         editorialBias: 'hostile' },
  'spectator.co.uk':      { name: 'The Spectator',       domain: 'spectator.co.uk',      editorialBias: 'hostile' },
  'gbnews.com':           { name: 'GB News',             domain: 'gbnews.com',           editorialBias: 'hostile' },
  'talk.tv':              { name: 'TalkTV',              domain: 'talk.tv',              editorialBias: 'hostile' },
  'thetimes.co.uk':       { name: 'The Times',           domain: 'thetimes.co.uk',       editorialBias: 'hostile' },
  // UK press — negative
  'express.co.uk':        { name: 'Daily Express',       domain: 'express.co.uk',        editorialBias: 'negative' },
  'theguardian.com':      { name: 'The Guardian',        domain: 'theguardian.com',      editorialBias: 'negative' },
  'bbc.co.uk':            { name: 'BBC News',            domain: 'bbc.co.uk',            editorialBias: 'negative' },
  'itv.com':              { name: 'ITV News',            domain: 'itv.com',              editorialBias: 'negative' },
  // UK press — neutral
  'independent.co.uk':    { name: 'The Independent',     domain: 'independent.co.uk',    editorialBias: 'neutral' },
  'mirror.co.uk':         { name: 'The Mirror',          domain: 'mirror.co.uk',         editorialBias: 'neutral' },
  'inews.co.uk':          { name: 'The i',               domain: 'inews.co.uk',          editorialBias: 'neutral' },
  'sky.com':              { name: 'Sky News',            domain: 'sky.com',              editorialBias: 'neutral' },
  'metro.co.uk':          { name: 'Metro',               domain: 'metro.co.uk',          editorialBias: 'neutral' },
  // UK press — positive
  'channel4.com':         { name: 'Channel 4 News',      domain: 'channel4.com',         editorialBias: 'positive' },
  'huffingtonpost.co.uk': { name: 'HuffPost UK',         domain: 'huffingtonpost.co.uk', editorialBias: 'positive' },
  'vice.com':             { name: 'Vice UK',             domain: 'vice.com',             editorialBias: 'positive' },
  // LGBTQ+ media — supportive
  'pinknews.co.uk':       { name: 'Pink News',           domain: 'pinknews.co.uk',       editorialBias: 'supportive' },
  'attitude.co.uk':       { name: 'Attitude',            domain: 'attitude.co.uk',       editorialBias: 'supportive' },
  'divamag.co.uk':        { name: 'DIVA Magazine',       domain: 'divamag.co.uk',        editorialBias: 'supportive' },
  'them.us':              { name: 'Them',                domain: 'them.us',              editorialBias: 'supportive' },
  // Trans-led media — supportive
  'transvitae.com':       { name: 'TransVitae',          domain: 'transvitae.com',       editorialBias: 'supportive' },
  'transgenderfeed.com':  { name: 'Transgender Feed',    domain: 'transgenderfeed.com',  editorialBias: 'supportive' },
  'translash.org':        { name: 'TransLash',           domain: 'translash.org',        editorialBias: 'supportive' },
  'erininthemorning.com': { name: 'Erin in the Morning', domain: 'erininthemorning.com', editorialBias: 'supportive' },
  'assignedmedia.org':    { name: 'Assigned Media',      domain: 'assignedmedia.org',    editorialBias: 'supportive' },
  // International press
  'reuters.com':              { name: 'Reuters',              domain: 'reuters.com',              editorialBias: 'neutral' },
  'washingtonpost.com':       { name: 'Washington Post',      domain: 'washingtonpost.com',       editorialBias: 'neutral' },
  'nytimes.com':              { name: 'New York Times',        domain: 'nytimes.com',              editorialBias: 'neutral' },
  'advocate.com':             { name: 'The Advocate',          domain: 'advocate.com',             editorialBias: 'positive' },
  'ndtv.com':                 { name: 'NDTV',                  domain: 'ndtv.com',                 editorialBias: 'neutral' },
  'andrewsullivan.substack.com': { name: 'Andrew Sullivan',   domain: 'andrewsullivan.substack.com', editorialBias: 'hostile' },
  // Legal/advocacy
  'goodlawproject.org':       { name: 'Good Law Project',      domain: 'goodlawproject.org',       editorialBias: 'positive' },
  'lambdalegal.org':          { name: 'Lambda Legal',          domain: 'lambdalegal.org',          editorialBias: 'supportive' },
  'ilga.org':                 { name: 'ILGA World',            domain: 'ilga.org',                 editorialBias: 'supportive' },
  // Advocacy organisations — supportive
  'transactual.org.uk':   { name: 'TransActual',         domain: 'transactual.org.uk',   editorialBias: 'supportive' },
  'stonewall.org.uk':     { name: 'Stonewall',           domain: 'stonewall.org.uk',     editorialBias: 'supportive' },
  'transequality.org':    { name: 'Trans Equality',      domain: 'transequality.org',    editorialBias: 'supportive' },
  'transgenderlawcenter.org': { name: 'Trans Law Center', domain: 'transgenderlawcenter.org', editorialBias: 'supportive' },
  'glaad.org':            { name: 'GLAAD',               domain: 'glaad.org',            editorialBias: 'supportive' },
  'tgeu.org':             { name: 'TGEU',                domain: 'tgeu.org',             editorialBias: 'supportive' },
  'gate.ngo':             { name: 'GATE Global',         domain: 'gate.ngo',             editorialBias: 'supportive' },
};

function scoreToLabel(score: number): string {
  if (score <= 20) return 'hostile';
  if (score <= 40) return 'negative';
  if (score <= 60) return 'neutral';
  if (score <= 80) return 'positive';
  return 'supportive';
}

export async function scoreArticle(title: string, snippet: string): Promise<{ score: number; label: string; reason: string }> {
  const prompt = `You are a media bias analyst specialising in UK trans rights coverage.

Analyse this article and score its bias on a 0-100 scale where:
0-20  = hostile    (misgendering, deadnaming, "groomer" framing, biological essentialism used to deny rights)
21-40 = negative   (sceptical framing, "debate" language, gender-critical voices given primary platform)
41-60 = neutral    (factual reporting, balanced, no strong framing)
61-80 = positive   (inclusive language, trans voices quoted, affirming framing)
81-100 = supportive (trans-led perspective, advocacy-adjacent, explicitly affirmative)

Title: ${title}
Snippet: ${snippet || '(no snippet)'}

Respond ONLY with valid JSON, no markdown:
{"score": <integer 0-100>, "reason": "<one sentence max 20 words>"}`;

  const bedrock = new BedrockRuntimeClient({ region: 'eu-west-1' });
  const cmd = new InvokeModelCommand({
    modelId: BEDROCK_MODEL,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 120,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const result = await Promise.race([
    bedrock.send(cmd),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('bedrock_timeout')), BEDROCK_TIMEOUT_MS)
    ),
  ]);

  const raw = JSON.parse(new TextDecoder().decode((result as any).body));
  const text: string = raw.content?.[0]?.text ?? '';
  const parsed = JSON.parse(text.trim());
  const score = Math.max(0, Math.min(100, Math.round(parsed.score)));
  return { score, label: scoreToLabel(score), reason: parsed.reason ?? '' };
}

export async function ingestArticle(
  redis: ReturnType<typeof createClient>,
  record: { id: string; url: string; title: string; publishedAt: string; domain: string; score: number; label: string; reason: string; scoredAt: string }
): Promise<void> {
  const key = sourceArticlesKey(record.domain);
  await redis.lPush(key, JSON.stringify(record));
  await redis.lTrim(key, 0, MAX_ARTICLES_PER_SOURCE - 1);

  const metaRaw = await redis.hGetAll(sourceMetaKey(record.domain));
  const prevTotal = parseInt(metaRaw?.totalScore  ?? '0', 10);
  const prevCount = parseInt(metaRaw?.articleCount ?? '0', 10);
  const newCount  = prevCount + 1;
  const newTotal  = prevTotal + record.score;
  const avgScore  = Math.round(newTotal / newCount);

  await redis.hSet(sourceMetaKey(record.domain), {
    name:          SOURCE_REGISTRY[record.domain]?.name ?? record.domain,
    domain:        record.domain,
    editorialBias: SOURCE_REGISTRY[record.domain]?.editorialBias ?? 'neutral',
    articleCount:  String(newCount),
    totalScore:    String(newTotal),
    avgScore:      String(avgScore),
    avgLabel:      scoreToLabel(avgScore),
    lastSeenAt:    record.publishedAt,
    updatedAt:     new Date().toISOString(),
  });

  await redis.sAdd(biasIndexKey(), record.domain);
}

async function handleGetSources(redis: ReturnType<typeof createClient>) {
  const indexedDomains = await redis.sMembers(biasIndexKey());

  // Always include every configured source, even if it has not yet been scored.
  // Also include any historic Redis-only domains not currently in SOURCE_REGISTRY.
  const domains = Array.from(new Set([
    ...Object.keys(SOURCE_REGISTRY),
    ...indexedDomains,
  ]));

  const sources = await Promise.all(
    domains.map(async (domain) => {
      const meta = await redis.hGetAll(sourceMetaKey(domain));
      const registry = SOURCE_REGISTRY[domain];

      return {
        domain,
        name:          registry?.name ?? meta?.name ?? domain,
        editorialBias: registry?.editorialBias ?? meta?.editorialBias ?? 'neutral',
        articleCount:  parseInt(meta?.articleCount ?? '0', 10),
        avgScore:      meta?.avgScore ? parseInt(meta.avgScore, 10) : null,
        avgLabel:      meta?.avgLabel ?? null,
        lastSeenAt:    meta?.lastSeenAt ?? null,
      };
    })
  );

  sources.sort((a, b) => {
    const countDiff = b.articleCount - a.articleCount;
    if (countDiff !== 0) return countDiff;
    return a.name.localeCompare(b.name);
  });

  return { statusCode: 200, body: JSON.stringify({ sources }) };
}

async function handleGetSource(redis: ReturnType<typeof createClient>, domain: string) {
  const key = sourceArticlesKey(domain);
  const rawItems = await redis.lRange(key, 0, MAX_ARTICLES_PER_SOURCE - 1);
  const articles = rawItems.map((r: string) => { try { return JSON.parse(r); } catch { return null; } }).filter(Boolean);
  const meta = await redis.hGetAll(sourceMetaKey(domain));
  return {
    statusCode: 200,
    body: JSON.stringify({
      domain,
      name:          meta?.name ?? SOURCE_REGISTRY[domain]?.name ?? domain,
      editorialBias: meta?.editorialBias ?? SOURCE_REGISTRY[domain]?.editorialBias ?? 'neutral',
      articleCount:  parseInt(meta?.articleCount ?? '0', 10),
      avgScore:      meta?.avgScore ? parseInt(meta.avgScore, 10) : null,
      avgLabel:      meta?.avgLabel ?? null,
      articles,
    }),
  };
}

export const handler = async (event: any) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  const redisUrl = process.env.REDIS_URL;
  let redis: ReturnType<typeof createClient> | null = null;

  try {
    if (!redisUrl) throw new Error('REDIS_URL not set');
    redis = createClient({ url: redisUrl });
    await redis.connect();

    const path = event.path ?? event.rawPath ?? '';
    let result: { statusCode: number; body: string };

    if (path.endsWith('/media/v1/sources') || path.endsWith('/media/v1/sources/')) {
      result = await handleGetSources(redis);
    } else {
      const domainMatch = path.match(/\/media\/v1\/source\/([^/]+)$/);
      if (domainMatch) {
        result = await handleGetSource(redis, decodeURIComponent(domainMatch[1]));
      } else {
        result = { statusCode: 404, body: JSON.stringify({ error: 'not_found' }) };
      }
    }

    await redis.disconnect();
    return { ...result, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } };

  } catch (err: any) {
    try { await redis?.disconnect(); } catch {}
    console.error('media-bias error', err);
    return {
      statusCode: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message ?? 'internal_error' }),
    };
  }
};
