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

  try {
    if (path.endsWith('/list-climate-news')) {
      const data = await redisGet('climate:news-intelligence:v1');
      return ok(data || { items: [], fetchedAt: 0 }, 300);
    }
    if (path.endsWith('/list-climate-anomalies')) {
      const data = await redisGet('climate:anomalies:v2');
      return ok(data || { anomalies: [] }, 600);
    }
    if (path.endsWith('/list-climate-disasters')) {
      const data = await redisGet('climate:disasters:v1');
      return ok(data || { events: [] }, 600);
    }
    if (path.endsWith('/get-co2-monitoring')) {
      const data = await redisGet('climate:co2-monitoring:v1');
      return ok(data || {}, 3600);
    }
    if (path.endsWith('/get-ocean-ice-data')) {
      const data = await redisGet('climate:ocean-ice:v1');
      return ok(data || {}, 3600);
    }
    if (path.endsWith('/list-air-quality-data')) {
      const data = await redisGet('climate:air-quality:v1');
      return ok(data || { stations: [] }, 300);
    }

    return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: 'Not found' }) };
  } catch (e) {
    console.error('[climate] error:', e);
    return err({});
  }
};
