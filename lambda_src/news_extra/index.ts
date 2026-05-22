import { createCluster } from 'redis';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

let client: ReturnType<typeof createCluster> | null = null;
async function getClient() {
  if (client && client.isOpen) return client;
  client = createCluster({ rootNodes: [{ url: process.env.REDIS_URL! }], defaults: { socket: { tls: true } } });
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
        return ok({ summary: cached.summary, model: cached.model || '', provider: 'cache', tokens: 0, fallback: false, error: '', errorType: '', status: 'SUMMARIZE_STATUS_CACHED', statusDetail: '' });
      }
      return ok(EMPTY_MISS);
    }

    if (path.endsWith('/summarize-article')) {
      let body: any = {};
      if (event.body) { try { body = JSON.parse(event.body); } catch {} }
      const { headlines = [], mode = 'brief', variant = 'trans', lang = 'en' } = body;
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
