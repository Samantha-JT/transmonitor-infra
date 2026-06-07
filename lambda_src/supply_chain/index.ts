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

export const handler = async (event: { rawPath?: string; path?: string; queryStringParameters?: Record<string, string>; requestContext?: { http?: { method?: string } } }) => {
  if (event.requestContext?.http?.method === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  const path = event.rawPath || event.path || '';
  const qs = event.queryStringParameters || {};
  try {
    if (path.includes('/hormuz-tracker') || path.endsWith('/get-chokepoint-status')) return ok(await redisGet('supply_chain:chokepoints:v4') ?? { chokepoints: [] }, 300);
    if (path.endsWith('/get-shipping-rates'))    return ok(await redisGet('supply_chain:shipping:v2')       ?? { indices: [], fetchedAt: new Date().toISOString(), upstreamUnavailable: true }, 300);
    if (path.endsWith('/get-critical-minerals')) return ok(await redisGet('supply_chain:minerals:v2')       ?? { minerals: [] }, 3600);
    if (path.endsWith('/get-shipping-stress'))   return ok(await redisGet('supply_chain:shipping_stress:v1') ?? {}, 300);
    if (path.endsWith('/get-country-chokepoint-index')) {
      const iso2 = qs.iso2 || path.split('/').pop() || '';
      return ok(await redisGet(`supply-chain:exposure:${iso2}:all:v1`) ?? {}, 600);
    }
    if (path.endsWith('/get-country-cost-shock')) {
      return ok(await redisGet(`supply-chain:cost-shock:${qs.iso2 || ''}:${qs.chokepointId || ''}:v1`) ?? {}, 600);
    }
    return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: 'Not found' }) };
  } catch (e: any) {
    console.error('[supply_chain]', e?.message);
    return ok({});
  }
};
