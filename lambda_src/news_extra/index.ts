import { createClient } from "redis";;
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

let client: ReturnType<typeof createClient> | null = null;
async function getClient() {
  if (client && client.isOpen) return client;
  client = createClient({ url: process.env.REDIS_URL!, socket: { tls: true } });
  await client.connect();
  return client;
}

async function redisGet(key: string): Promise<unknown> {
  const redis = await getClient();
  const raw = await redis.get(key);
  if (!raw) return null;
  const parsed = JSON.parse(raw);
  if (parsed && typeof parsed === 'object' && '_seed' in parsed && 'data' in parsed) return (parsed as any).data;
  return parsed;
}

async function redisSetEx(key: string, ttl: number, value: string): Promise<void> {
  const redis = await getClient();
  await redis.set(key, value, { EX: ttl });
}

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-origin-verify' };
const ok = (body: unknown) => ({ statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });

const EMPTY_MISS = { summary: '', model: '', provider: '', tokens: 0, fallback: true, error: '', errorType: '', status: 'SUMMARIZE_STATUS_UNSPECIFIED', statusDetail: '' };
const CACHE_KEY_PATTERN = /^summary:v\d+:[a-z0-9:_-]{3,120}$/;

const bedrock = new BedrockRuntimeClient({ region: 'eu-west-1' });
const BEDROCK_MODEL = 'eu.anthropic.claude-haiku-4-5-20251001-v1:0';

const FETCH_TIMEOUT_MS = 7000;
const MIN_BODY_CHARS = 400;       // below this, extraction is too thin — fall back to headlines
const MAX_BODY_CHARS = 6000;      // truncate before sending to Bedrock (token budget)
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// Lightweight HTML -> readable text. No jsdom/Readability (keeps the in-VPC
// bundle small and cold-starts fast). Strips non-content elements, prefers
// <article>/<main> if present, collapses to plain text. Rough but adequate —
// Bedrock summarises messy-but-present text fine.
function extractText(html: string): string {
  let h = html;
  // Drop elements whose content is never article text.
  h = h.replace(/<script[\s\S]*?<\/script>/gi, ' ')
       .replace(/<style[\s\S]*?<\/style>/gi, ' ')
       .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
       .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
       .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
       .replace(/<header[\s\S]*?<\/header>/gi, ' ')
       .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
       .replace(/<aside[\s\S]*?<\/aside>/gi, ' ')
       .replace(/<form[\s\S]*?<\/form>/gi, ' ');
  // Prefer the main article container if we can find one.
  const article = h.match(/<article[\s\S]*?<\/article>/i)?.[0]
               ?? h.match(/<main[\s\S]*?<\/main>/i)?.[0]
               ?? h;
  // Strip remaining tags, decode a few common entities, collapse whitespace.
  const text = article
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
  return text;
}

async function fetchArticleBody(url: string): Promise<string | null> {
  // Only fetch http(s) URLs.
  if (!/^https?:\/\//i.test(url)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': BROWSER_UA, 'Accept': 'text/html,application/xhtml+xml' },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!resp.ok) { console.warn('[body] fetch status', resp.status, url); return null; }
    const ctype = resp.headers.get('content-type') || '';
    if (!ctype.includes('html')) { console.warn('[body] non-html', ctype, url); return null; }
    const html = await resp.text();
    const text = extractText(html);
    if (text.length < MIN_BODY_CHARS) { console.warn('[body] too thin', text.length, url); return null; }
    return text.slice(0, MAX_BODY_CHARS);
  } catch (e: any) {
    console.warn('[body] fetch failed', e?.name || e?.message, url);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function summariseWithBedrock(headlines: string[], mode: string): Promise<{ summary: string; model: string; tokens: number } | null> {
  try {
    const prompt = `Summarize the top news story from these headlines in 2-3 sentences. Be factual and concise.\n\n${headlines.slice(0, 5).join('\n')}`;
    const body = JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 150,
      messages: [{ role: 'user', content: prompt }],
    });
    const cmd = new InvokeModelCommand({
      modelId: BEDROCK_MODEL,
      contentType: 'application/json',
      accept: 'application/json',
      body,
    });
    const resp = await bedrock.send(cmd);
    const result = JSON.parse(new TextDecoder().decode(resp.body)) as any;
    const text = result.content?.[0]?.text?.trim();
    if (!text) return null;
    return { summary: text, model: BEDROCK_MODEL, tokens: (result.usage?.input_tokens ?? 0) + (result.usage?.output_tokens ?? 0) };
  } catch (e: any) {
    console.error('[Bedrock]', e?.message);
    return null;
  }
}

// Option B: summarise the article BODY, returning summary + keyPoints.
// Returns null on any failure so the caller can fall back to headlines.
async function summariseBodyWithBedrock(bodyText: string): Promise<{ summary: string; keyPoints: string[]; model: string; tokens: number } | null> {
  try {
    const prompt = `You are summarising a news article about trans-related topics. Read the article text below and respond with ONLY a JSON object (no markdown, no preamble) of the form:
{"summary": "<2-3 factual sentences>", "keyPoints": ["<point 1>", "<point 2>", "<point 3>"]}
Be factual, neutral, and concise. 3-4 key points maximum.

ARTICLE:
${bodyText}`;
    const body = JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    });
    const cmd = new InvokeModelCommand({
      modelId: BEDROCK_MODEL,
      contentType: 'application/json',
      accept: 'application/json',
      body,
    });
    const resp = await bedrock.send(cmd);
    const result = JSON.parse(new TextDecoder().decode(resp.body)) as any;
    let text = result.content?.[0]?.text?.trim();
    if (!text) return null;
    // Strip a stray ```json fence if the model adds one.
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    let parsed: any;
    try { parsed = JSON.parse(text); } catch { console.warn('[body] non-JSON model output'); return null; }
    const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : '';
    if (!summary) return null;
    const keyPoints = Array.isArray(parsed.keyPoints)
      ? parsed.keyPoints.filter((k: unknown) => typeof k === 'string' && k.trim()).slice(0, 4)
      : [];
    return { summary, keyPoints, model: BEDROCK_MODEL, tokens: (result.usage?.input_tokens ?? 0) + (result.usage?.output_tokens ?? 0) };
  } catch (e: any) {
    console.error('[Bedrock body]', e?.message);
    return null;
  }
}

export const handler = async (event: { rawPath?: string; path?: string; queryStringParameters?: Record<string, string>; requestContext?: { http?: { method?: string } }; body?: string }) => {
  if (event.requestContext?.http?.method === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  const path = event.rawPath || event.path || '';
  const qs = event.queryStringParameters || {};

  try {
    if (path.endsWith('/summarize-article-cache') || path.endsWith('/get-summarize-article-cache')) {
      const cacheKey = qs.cache_key || qs.cacheKey || '';
      if (!cacheKey || !CACHE_KEY_PATTERN.test(cacheKey)) {
        return ok({ ...EMPTY_MISS, status: 'SUMMARIZE_STATUS_ERROR', error: 'Invalid cache key' });
      }
      const cached = await redisGet(cacheKey).catch(() => null) as any;
      if (cached?.summary) {
        return ok({ summary: cached.summary, model: cached.model || '', keyPoints: cached.keyPoints || [], provider: 'cache', tokens: 0, fallback: false, error: '', errorType: '', status: 'SUMMARIZE_STATUS_CACHED', statusDetail: '' });
      }
      return ok(EMPTY_MISS);
    }

    if (path.endsWith('/summarize-article')) {
      let body: any = {};
      if (event.body) { try { body = JSON.parse(event.body); } catch {} }
      const { headlines = [], url = '', mode = 'brief', variant = 'trans', lang = 'en' } = body;
      if (!headlines.length && !url) return ok({ ...EMPTY_MISS, status: 'SUMMARIZE_STATUS_ERROR', error: 'Headlines or url required' });

      // ── Option B: try to summarise the article body first ──────────────────
      // Cache key keyed on url so body summaries are reused across views.
      if (url && /^https?:\/\//i.test(url)) {
        const bodyCacheKey = `summarize:v2:body:${variant}:${lang}:${Buffer.from(url).toString('base64').slice(0, 48)}`;
        const cachedBody = await redisGet(bodyCacheKey).catch(() => null) as any;
        if (cachedBody?.summary) {
          return ok({ ...cachedBody, provider: 'cache', tokens: 0, fallback: false, error: '', errorType: '', status: 'SUMMARIZE_STATUS_CACHED', statusDetail: '' });
        }
        const bodyText = await fetchArticleBody(url);
        if (bodyText) {
          const bodyResult = await summariseBodyWithBedrock(bodyText);
          if (bodyResult) {
            await redisSetEx(bodyCacheKey, 3600, JSON.stringify(bodyResult)).catch(() => {});
            console.log('[summarize] body path ok', url);
            return ok({ ...bodyResult, provider: 'bedrock-body', fallback: false, error: '', errorType: '', status: 'SUMMARIZE_STATUS_SUCCESS', statusDetail: '' });
          }
        }
        console.log('[summarize] body path unavailable, falling back to headlines', url);
      }

      // ── Fallback: headline summary (original behaviour) ────────────────────
      if (!headlines.length) return ok({ ...EMPTY_MISS, status: 'SUMMARIZE_STATUS_ERROR', error: 'Headlines required' });

      const cacheKey = `summarize:v1:${mode}:${variant}:${lang}:${Buffer.from(headlines.slice(0,5).join('|')).toString('base64').slice(0,32)}`;
      const cached = await redisGet(cacheKey).catch(() => null) as any;
      if (cached?.summary) return ok({ ...cached, provider: 'cache', tokens: 0, fallback: false, status: 'SUMMARIZE_STATUS_CACHED', statusDetail: '' });

      const result = await summariseWithBedrock(headlines, mode);
      if (result) {
        await redisSetEx(cacheKey, 3600, JSON.stringify(result)).catch(() => {});
        return ok({ ...result, provider: 'bedrock', fallback: false, error: '', errorType: '', status: 'SUMMARIZE_STATUS_SUCCESS', statusDetail: '' });
      }
      return ok({ ...EMPTY_MISS, status: 'SUMMARIZE_STATUS_ERROR', error: 'Bedrock invocation failed' });
    }

    return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: 'Not found' }) };
  } catch (e: any) {
    console.error('[news_extra]', e?.message);
    return ok(EMPTY_MISS);
  }
};
