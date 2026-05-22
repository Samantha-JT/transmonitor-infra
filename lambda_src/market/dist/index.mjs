import { createServer } from 'http';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-origin-verify',
};

async function redisGet(key) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error('Redis credentials not configured');
  const resp = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(3000),
  });
  if (!resp.ok) throw new Error(`Redis HTTP ${resp.status}`);
  const data = await resp.json();
  if (!data.result) return null;
  const parsed = JSON.parse(data.result);
  // Unwrap seed envelope {_seed, data} if present
  if (parsed && typeof parsed === 'object' && '_seed' in parsed && 'data' in parsed) {
    return parsed.data;
  }
  return parsed;
}

function ok(body, ttl = 60) {
  return {
    statusCode: 200,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${ttl}, stale-while-revalidate=60` },
    body: JSON.stringify(body),
  };
}

function err(body = {}) {
  return {
    statusCode: 200, // Return 200 with empty payload so panel shows graceful empty state
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

// Route dispatch
export const handler = async (event) => {
  if (event.requestContext?.http?.method === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  const path = event.rawPath || event.path || '';
  const qs = event.queryStringParameters || {};

  try {
    // Market quotes
    if (path.endsWith('/list-market-quotes')) {
      const data = await redisGet('market:stocks-bootstrap:v1');
      if (!data?.quotes?.length) return ok({ quotes: [], finnhubSkipped: false, skipReason: '', rateLimited: false });
      const symbols = (qs.symbols || '').split(',').filter(Boolean);
      if (symbols.length > 0) {
        const set = new Set(symbols);
        return ok({ ...data, quotes: data.quotes.filter(q => set.has(q.symbol)) });
      }
      return ok(data);
    }

    // Crypto quotes
    if (path.endsWith('/list-crypto-quotes')) {
      const data = await redisGet('market:crypto:v1');
      return ok(data || { quotes: [] });
    }

    // Crypto sectors
    if (path.endsWith('/list-crypto-sectors')) {
      const data = await redisGet('market:crypto-sectors:v1');
      return ok(data || { sectors: [] });
    }

    // DeFi tokens
    if (path.endsWith('/list-defi-tokens')) {
      const data = await redisGet('market:defi-tokens:v1');
      return ok(data || { tokens: [] });
    }

    // AI tokens
    if (path.endsWith('/list-ai-tokens')) {
      const data = await redisGet('market:ai-tokens:v1');
      return ok(data || { tokens: [] });
    }

    // Other tokens
    if (path.endsWith('/list-other-tokens')) {
      const data = await redisGet('market:other-tokens:v1');
      return ok(data || { tokens: [] });
    }

    // Fear & Greed
    if (path.endsWith('/get-fear-greed-index')) {
      const data = await redisGet('market:fear-greed:v1');
      return ok(data || { compositeScore: 0, compositeLabel: '', unavailable: true });
    }

    // Stablecoin markets
    if (path.endsWith('/list-stablecoin-markets')) {
      const data = await redisGet('market:stablecoins:v1');
      return ok(data || { stablecoins: [], summary: { healthStatus: 'UNAVAILABLE' }, timestamp: new Date().toISOString() });
    }

    // ETF flows
    if (path.endsWith('/list-etf-flows')) {
      const data = await redisGet('market:etf-flows:v1');
      return ok(data || { etfs: [], summary: { netDirection: 'UNAVAILABLE' }, timestamp: new Date().toISOString(), rateLimited: false });
    }

    // Gulf quotes
    if (path.endsWith('/list-gulf-quotes')) {
      const data = await redisGet('market:gulf-quotes:v1');
      return ok(data || { quotes: [] });
    }

    // Gold intelligence
    if (path.endsWith('/get-gold-intelligence')) {
      const [commodities, cot, extended, etfFlows, cbReserves] = await Promise.allSettled([
        redisGet('market:commodities-bootstrap:v1'),
        redisGet('market:cot:v1'),
        redisGet('market:gold-extended:v1'),
        redisGet('market:gold-etf-flows:v1'),
        redisGet('market:gold-cb-reserves:v1'),
      ]);
      const quotes = commodities.status === 'fulfilled' ? commodities.value?.quotes || [] : [];
      const quoteMap = Object.fromEntries(quotes.map(q => [q.symbol, q]));
      const gold = quoteMap['GC=F'];
      if (!gold) return ok({ goldPrice: 0, goldChangePct: 0, goldSparkline: [], silverPrice: 0, platinumPrice: 0, palladiumPrice: 0, crossCurrencyPrices: [], drivers: [], updatedAt: '', unavailable: true });
      const ext = extended.status === 'fulfilled' ? extended.value : null;
      return ok({
        goldPrice: gold.price || 0,
        goldChangePct: gold.change || 0,
        goldSparkline: gold.sparkline || [],
        silverPrice: quoteMap['SI=F']?.price || 0,
        platinumPrice: quoteMap['PL=F']?.price || 0,
        palladiumPrice: quoteMap['PA=F']?.price || 0,
        crossCurrencyPrices: [],
        drivers: ext?.drivers || [],
        updatedAt: ext?.updatedAt || '',
        etfFlows: etfFlows.status === 'fulfilled' ? etfFlows.value : undefined,
        cbReserves: cbReserves.status === 'fulfilled' ? cbReserves.value : undefined,
        unavailable: false,
      });
    }

    // Earnings calendar
    if (path.endsWith('/list-earnings-calendar')) {
      const data = await redisGet('market:earnings-calendar:v1');
      return ok(data || { events: [], count: 0 });
    }

    // COT positioning
    if (path.endsWith('/get-cot-positioning')) {
      const data = await redisGet('market:cot:v1');
      return ok(data || { instruments: [] });
    }

    // Market breadth
    if (path.endsWith('/get-market-breadth-history')) {
      const data = await redisGet('market:breadth:v1');
      return ok(data || { history: [] });
    }

    // Market quotes (commodity)
    if (path.endsWith('/list-commodity-quotes')) {
      const data = await redisGet('market:commodities-bootstrap:v1');
      return ok(data || { quotes: [] });
    }

    return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: 'Not found' }) };
  } catch (e) {
    console.error('[market] error:', e);
    return err({ error: e.message });
  }
};
