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

async function getFredBatch(seriesIds, limit) {
  const ALLOWED = new Set(['WALCL','FEDFUNDS','T10Y2Y','UNRATE','CPIAUCSL','DGS10','VIXCLS','GDP','M2SL','DCOILWTICO','BAMLH0A0HYM2','ICSA','MORTGAGE30US','GSCPI','T10Y3M','STLFSI4','DGS1MO','DGS3MO','DGS6MO','DGS1','DGS2','DGS5','DGS30','BAMLC0A0CM','SOFR','ESTR','EURIBOR3M','EURIBOR6M','EURIBOR1Y']);
  const ids = [...new Set(seriesIds.map(s => s.trim().toUpperCase()).filter(s => ALLOWED.has(s)))].slice(0, 20);
  const settled = await Promise.allSettled(ids.map(id => redisGet(`fred:seed:${id}:v1`)));
  const results = {};
  for (let i = 0; i < ids.length; i++) {
    const r = settled[i];
    if (r.status === 'fulfilled' && r.value?.series) results[ids[i]] = r.value.series;
  }
  return { results, fetched: Object.keys(results).length, requested: ids.length };
}

export const handler = async (event) => {
  if (event.requestContext?.http?.method === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  const path = event.rawPath || event.path || '';
  const method = event.requestContext?.http?.method || 'GET';

  try {
    if (path.endsWith('/get-macro-signals')) {
      const data = await redisGet('economic:macro-signals:v1');
      return ok(data || { verdict: 'UNKNOWN', bullishCount: 0, totalCount: 0, signals: {}, meta: {}, unavailable: true, timestamp: new Date().toISOString() });
    }

    if (path.endsWith('/get-fred-series-batch')) {
      let body = {};
      if (method === 'POST' && event.body) {
        try { body = JSON.parse(event.body); } catch {}
      }
      const ids = body.seriesIds || body.series_ids || [];
      const limit = parseInt(body.limit || '100', 10);
      return ok(await getFredBatch(ids, limit));
    }

    if (path.endsWith('/list-bigmac-prices')) {
      const data = await redisGet('economic:bigmac:v1');
      return ok(data || { prices: [] });
    }

    if (path.endsWith('/list-fuel-prices')) {
      const data = await redisGet('economic:fuel-prices:v1');
      return ok(data || { prices: [] });
    }

    if (path.endsWith('/list-grocery-basket-prices')) {
      const data = await redisGet('economic:grocery-basket:v1');
      return ok(data || { items: [] });
    }

    if (path.endsWith('/get-economic-calendar')) {
      const data = await redisGet('economic:econ-calendar:v1');
      return ok(data || { events: [] });
    }

    if (path.endsWith('/get-eurostat-country-data')) {
      const data = await redisGet('economic:eurostat-country-data:v1');
      return ok(data || {});
    }

    if (path.endsWith('/get-energy-crisis-policies')) {
      const data = await redisGet('energy:crisis-policies:v1');
      return ok(data || { policies: [] });
    }

    if (path.endsWith('/get-eu-yield-curve')) {
      const data = await redisGet('economic:eu-yield-curve:v1');
      return ok(data || { tenors: [] });
    }

    if (path.endsWith('/get-fao-food-price-index')) {
      const data = await redisGet('economic:fao-food-price:v1');
      return ok(data || { indices: [] });
    }

    if (path.endsWith('/get-crude-inventories')) {
      const data = await redisGet('economic:crude-inventories:v1');
      return ok(data || {});
    }

    if (path.endsWith('/get-nat-gas-storage')) {
      const data = await redisGet('economic:nat-gas-storage:v1');
      return ok(data || {});
    }

    if (path.endsWith('/get-ecb-fx-rates')) {
      const data = await redisGet('economic:ecb-fx-rates:v1');
      return ok(data || { rates: [] });
    }

    if (path.endsWith('/get-eu-gas-storage')) {
      const data = await redisGet('economic:eu-gas-storage:v1');
      return ok(data || {});
    }

    if (path.endsWith('/get-national-debt')) {
      const data = await redisGet('economic:national-debt:v1');
      return ok(data || {});
    }

    if (path.endsWith('/get-bis-policy-rates')) {
      const data = await redisGet('economic:bis-policy-rates:v1');
      return ok(data || { rates: [] });
    }

    if (path.endsWith('/get-bis-exchange-rates')) {
      const data = await redisGet('economic:bis-exchange-rates:v1');
      return ok(data || { rates: [] });
    }

    if (path.endsWith('/get-bis-credit')) {
      const data = await redisGet('economic:bis-credit:v1');
      return ok(data || {});
    }

    if (path.endsWith('/get-economic-stress')) {
      const data = await redisGet('economic:stress:v1');
      return ok(data || {});
    }

    return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: 'Not found' }) };
  } catch (e) {
    console.error('[economic] error:', e);
    return err({});
  }
};
