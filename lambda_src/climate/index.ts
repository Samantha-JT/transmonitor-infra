import { createClient } from "redis";;

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

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-origin-verify' };
const ok = (body: unknown, ttl = 300) => ({ statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${ttl}, stale-while-revalidate=60` }, body: JSON.stringify(body) });

export const handler = async (event: { rawPath?: string; path?: string; requestContext?: { http?: { method?: string } } }) => {
  if (event.requestContext?.http?.method === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  const path = event.rawPath || event.path || '';
  try {
    if (path.endsWith('/list-climate-news'))      return ok(await redisGet('climate:news-intelligence:v1') ?? { items: [], fetchedAt: 0 }, 300);
    if (path.endsWith('/list-climate-anomalies')) return ok(await redisGet('climate:anomalies:v2')           ?? { anomalies: [] }, 600);
    if (path.endsWith('/list-climate-disasters')) return ok(await redisGet('climate:disasters:v1')           ?? { events: [] }, 600);
    if (path.endsWith('/get-co2-monitoring'))     return ok(await redisGet('climate:co2-monitoring:v1')      ?? {}, 3600);
    if (path.endsWith('/get-ocean-ice-data'))     return ok(await redisGet('climate:ocean-ice:v1')           ?? {}, 3600);
    if (path.endsWith('/list-air-quality-data'))  return ok(await redisGet('climate:air-quality:v1')         ?? { stations: [] }, 300);
    return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: 'Not found' }) };
  } catch (e: any) {
    console.error('[climate]', e?.message);
    return ok({});
  }
};
