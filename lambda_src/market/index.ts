import { createCluster } from 'redis';

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

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-origin-verify' };
const ok = (body: unknown, ttl = 60) => ({ statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${ttl}, stale-while-revalidate=60` }, body: JSON.stringify(body) });
const empty = (fallback: unknown) => ok(fallback);

export const handler = async (event: { rawPath?: string; path?: string; queryStringParameters?: Record<string, string>; requestContext?: { http?: { method?: string } }; body?: string }) => {
  if (event.requestContext?.http?.method === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  const path = event.rawPath || event.path || '';
  const qs = event.queryStringParameters || {};

  try {
    if (path.endsWith('/list-market-quotes')) {
      const data = await redisGet('market:stocks-bootstrap:v1') as any;
      if (!data?.quotes?.length) return ok({ quotes: [], finnhubSkipped: false, skipReason: '', rateLimited: false });
      const symbols = (qs.symbols || '').split(',').filter(Boolean);
      if (symbols.length > 0) { const s = new Set(symbols); return ok({ ...data, quotes: data.quotes.filter((q: any) => s.has(q.symbol)) }); }
      return ok(data);
    }
    if (path.endsWith('/list-crypto-quotes'))       return ok(await redisGet('market:crypto:v1') ?? { quotes: [] });
    if (path.endsWith('/list-crypto-sectors'))      return ok(await redisGet('market:crypto-sectors:v1') ?? { sectors: [] });
    if (path.endsWith('/list-defi-tokens'))         return ok(await redisGet('market:defi-tokens:v1') ?? { tokens: [] });
    if (path.endsWith('/list-ai-tokens'))           return ok(await redisGet('market:ai-tokens:v1') ?? { tokens: [] });
    if (path.endsWith('/list-other-tokens'))        return ok(await redisGet('market:other-tokens:v1') ?? { tokens: [] });
    if (path.endsWith('/get-fear-greed-index'))     return ok(await redisGet('market:fear-greed:v1') ?? { compositeScore: 0, compositeLabel: '', unavailable: true });
    if (path.endsWith('/list-stablecoin-markets'))  return ok(await redisGet('market:stablecoins:v1') ?? { stablecoins: [], summary: { healthStatus: 'UNAVAILABLE' }, timestamp: new Date().toISOString() });
    if (path.endsWith('/list-etf-flows'))           return ok(await redisGet('market:etf-flows:v1') ?? { etfs: [], summary: { netDirection: 'UNAVAILABLE' }, timestamp: new Date().toISOString(), rateLimited: false });
    if (path.endsWith('/list-gulf-quotes'))         return ok(await redisGet('market:gulf-quotes:v1') ?? { quotes: [] });
    if (path.endsWith('/list-earnings-calendar'))   return ok(await redisGet('market:earnings-calendar:v1') ?? { events: [], count: 0 });
    if (path.endsWith('/get-cot-positioning'))      return ok(await redisGet('market:cot:v1') ?? { instruments: [] });
    if (path.endsWith('/get-market-breadth-history')) return ok(await redisGet('market:breadth:v1') ?? { history: [] });
    if (path.endsWith('/list-commodity-quotes'))    return ok(await redisGet('market:commodities-bootstrap:v1') ?? { quotes: [] });
    if (path.endsWith('/get-sector-summary'))        return ok(await redisGet('market:sectors:v2') ?? { sectors: [], period: '' });

    if (path.endsWith('/get-gold-intelligence')) {
      const [commodities, cot, extended, etfFlows, cbReserves] = await Promise.allSettled([
        redisGet('market:commodities-bootstrap:v1'),
        redisGet('market:cot:v1'),
        redisGet('market:gold-extended:v1'),
        redisGet('market:gold-etf-flows:v1'),
        redisGet('market:gold-cb-reserves:v1'),
      ]);
      const quotes: any[] = (commodities.status === 'fulfilled' ? (commodities.value as any)?.quotes : null) ?? [];
      const qmap = Object.fromEntries(quotes.map((q: any) => [q.symbol, q]));
      const gold = qmap['GC=F'];
      if (!gold) return ok({ goldPrice: 0, goldChangePct: 0, goldSparkline: [], silverPrice: 0, platinumPrice: 0, palladiumPrice: 0, crossCurrencyPrices: [], drivers: [], updatedAt: '', unavailable: true });
      const ext = extended.status === 'fulfilled' ? extended.value as any : null;
      return ok({ goldPrice: gold.price ?? 0, goldChangePct: gold.change ?? 0, goldSparkline: gold.sparkline ?? [], silverPrice: qmap['SI=F']?.price ?? 0, platinumPrice: qmap['PL=F']?.price ?? 0, palladiumPrice: qmap['PA=F']?.price ?? 0, crossCurrencyPrices: [], drivers: ext?.drivers ?? [], updatedAt: ext?.updatedAt ?? '', etfFlows: etfFlows.status === 'fulfilled' ? etfFlows.value : undefined, cbReserves: cbReserves.status === 'fulfilled' ? cbReserves.value : undefined, unavailable: false });
    }

    return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: 'Not found' }) };
  } catch (e: any) {
    console.error('[market]', e?.message);
    return ok({ error: e?.message });
  }
};
