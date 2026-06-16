import { createClient } from 'redis';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import {
  SOURCE_REGISTRY,
  biasScoreToLabel as scoreToLabel,
  extractBiasDomain,
  EDITORIAL_BY_DOMAIN,
  simpleHash,
} from '../_shared/media-bias-domains.js';
import {
  BIAS_QUEUE_KEY,
  BIAS_DEDUP_TTL_SECONDS,
  biasDedupKey,
  type BiasQueueRef,
} from '../_shared/media-bias-queue.js';

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

// SOURCE_REGISTRY now imported from ../_shared/media-bias-domains.js (single source of truth)

// scoreToLabel now imported (biasScoreToLabel) from ../_shared/media-bias-domains.js

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

  // SOURCE_REGISTRY is the source of truth for monitored sources. We do NOT
  // union with the Redis bias index, so removing a source from the registry
  // removes it from the monitor even if it still has cached scored articles.
  const domains = Object.keys(SOURCE_REGISTRY);

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

// ── Scheduled scoring consumer (PR2) ─────────────────────────────────────────
//
// Drains media:bias:queue, scores each ref via Bedrock and ingests the result.
// This is the async/event-driven path that replaces the inline scoring the
// news-digest read handler does today. Uses the richer relevance-gated prompt
// (relevance check + editorial-stance context) carried over from the digest's
// scoreAndIngestBias, so cron-scored output matches the inline path.

const BIAS_MAX_PER_RUN = Number(process.env.BIAS_MAX_PER_RUN ?? '20');
const BIAS_RUN_BUDGET_MS = Number(process.env.BIAS_RUN_BUDGET_MS ?? '50000');

interface RelevanceScore { relevant: boolean; score: number | null; reason: string }

async function scoreArticleGated(ref: BiasQueueRef, domain: string): Promise<RelevanceScore> {
  const editorialStance = EDITORIAL_BY_DOMAIN[domain] ?? 'neutral';
  const text = [
    `Source: ${ref.source}`,
    `Title: ${ref.title}`,
    ref.summary ? `Summary: ${ref.summary}` : '',
  ].filter(Boolean).join('\n');

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

${text}

Respond ONLY with valid JSON, no markdown:
{"relevant": true|false, "score": <integer 0-100 if relevant else null>, "reason": "<one sentence max 20 words>"}`;

  const bedrock = new BedrockRuntimeClient({ region: process.env.AWS_BEDROCK_REGION ?? 'eu-west-1' });
  const result = await Promise.race([
    bedrock.send(new InvokeModelCommand({
      modelId: process.env.AWS_BEDROCK_MODEL_ID ?? BEDROCK_MODEL,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 120,
        messages: [{ role: 'user', content: prompt }],
      }),
    })),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('bedrock_timeout')), BEDROCK_TIMEOUT_MS)),
  ]);

  const raw = JSON.parse(new TextDecoder().decode((result as any).body));
  const rawText = (raw.content?.[0]?.text ?? '').trim().replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
  if (!rawText) throw new Error('empty_bedrock_response');
  const parsed = JSON.parse(rawText);
  return {
    relevant: parsed.relevant !== false,
    score: parsed.relevant === false ? null : Math.max(0, Math.min(100, Math.round(parsed.score ?? 50))),
    reason: parsed.reason ?? '',
  };
}

async function scheduledBiasHandler(): Promise<{ statusCode: number; body: string }> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) throw new Error('REDIS_URL not set');

  const redis = createClient({ url: redisUrl });
  await redis.connect();

  const deadline = Date.now() + BIAS_RUN_BUDGET_MS;
  let scored = 0, skippedDup = 0, skippedIrrelevant = 0, unresolved = 0, processed = 0;

  try {
    while (processed < BIAS_MAX_PER_RUN && Date.now() < deadline) {
      const raw = await redis.lPop(BIAS_QUEUE_KEY);
      if (!raw) break; // queue drained
      processed++;

      let ref: BiasQueueRef;
      try { ref = JSON.parse(raw); } catch { continue; }

      const domain = extractBiasDomain(ref.url, ref.source, ref.title);
      if (!domain) { unresolved++; continue; }

      const titleClean = (ref.title ?? '').trim();
      if (titleClean.length < 20 || titleClean === ref.source) continue;

      const urlHash = simpleHash(ref.url);
      const dedupKey = biasDedupKey(urlHash);
      if (await redis.get(dedupKey)) { skippedDup++; continue; }

      let rel: RelevanceScore;
      try {
        rel = await scoreArticleGated(ref, domain);
      } catch (err) {
        console.warn('[media-bias:cron] score failed', { domain, title: ref.title, err: (err as Error).message });
        continue;
      }

      if (!rel.relevant || rel.score === null) { skippedIrrelevant++; continue; }

      // Reserve the dedup key only once we know we will ingest.
      await redis.set(dedupKey, '1', { EX: BIAS_DEDUP_TTL_SECONDS });

      // Fire-and-forget Wayback archival (carried over from the inline path).
      if (typeof fetch !== 'undefined') {
        fetch(`https://web.archive.org/save/${encodeURIComponent(ref.url)}`, {
          method: 'GET',
          redirect: 'manual',
          signal: (AbortSignal as any).timeout?.(3000) ?? null,
        }).catch(() => {});
      }

      await ingestArticle(redis, {
        id: urlHash,
        url: ref.url,
        title: ref.title,
        publishedAt: new Date(ref.publishedAt).toISOString(),
        domain,
        score: rel.score,
        label: scoreToLabel(rel.score),
        reason: rel.reason,
        scoredAt: new Date().toISOString(),
      });
      scored++;
    }

    const summary = { processed, scored, skippedDup, skippedIrrelevant, unresolved, remaining: await redis.lLen(BIAS_QUEUE_KEY) };
    console.log('[media-bias:cron] run complete', summary);
    return { statusCode: 200, body: JSON.stringify(summary) };
  } finally {
    await redis.disconnect().catch(() => {});
  }
}

function isScheduledEvent(event: any): boolean {
  // EventBridge Scheduler/Rule events carry source 'aws.events'/'aws.scheduler'
  // or a detail-type; they have no HTTP method or path.
  return event?.source === 'aws.scheduler'
    || event?.source === 'aws.events'
    || event?.['detail-type'] !== undefined
    || event?.biasScoreRun === true; // manual/test trigger
}

export const handler = async (event: any) => {
  if (isScheduledEvent(event)) {
    return scheduledBiasHandler();
  }

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
