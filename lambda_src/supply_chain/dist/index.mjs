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

export const handler = async (event) => {
  if (event.requestContext?.http?.method === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  const path = event.rawPath || event.path || '';
  const qs = event.queryStringParameters || {};

  try {
    // Hormuz tracker (legacy path used by frontend)
    if (path.includes('/hormuz-tracker') || path.endsWith('/get-chokepoint-status')) {
      const data = await redisGet('supply_chain:chokepoints:v4');
      return ok(data || { chokepoints: [] }, 300);
    }

    if (path.endsWith('/get-shipping-rates')) {
      const data = await redisGet('supply_chain:shipping:v2');
      return ok(data || { routes: [] }, 300);
    }

    if (path.endsWith('/get-critical-minerals')) {
      const data = await redisGet('supply_chain:minerals:v2');
      return ok(data || { minerals: [] }, 3600);
    }

    if (path.endsWith('/get-shipping-stress')) {
      const data = await redisGet('supply_chain:shipping_stress:v1');
      return ok(data || {}, 300);
    }

    // Parameterised routes
    if (path.includes('/get-country-chokepoint-index')) {
      const iso2 = qs.iso2 || path.split('/').pop() || '';
      const data = await redisGet(`supply-chain:exposure:${iso2}:all:v1`);
      return ok(data || {}, 600);
    }

    if (path.includes('/get-country-cost-shock')) {
      const iso2 = qs.iso2 || '';
      const chokepointId = qs.chokepointId || '';
      const data = await redisGet(`supply-chain:cost-shock:${iso2}:${chokepointId}:v1`);
      return ok(data || {}, 600);
    }

    return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: 'Not found' }) };
  } catch (e) {
    console.error('[supply-chain] error:', e);
    return err({});
  }
};
