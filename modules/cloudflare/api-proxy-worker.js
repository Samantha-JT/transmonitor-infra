const API_GATEWAY = "https://8soi33z3h9.execute-api.eu-west-1.amazonaws.com/";
const S3_ORIGIN   = "transmonitor-prod-static.s3-website-eu-west-1.amazonaws.com";
const NO_CACHE_PATHS = new Set(["/sw.js"]);
const SHORT_CACHE_PATHS = new Set(["/", "/index.html"]);

// API cache TTLs in seconds — tune per endpoint based on how often data changes
const API_CACHE_TTL = {
  "/api/news":                300,   // 5 min — feed updates regularly
  "/api/media-bias":          900,   // 15 min — Bedrock scoring is expensive
  "/api/hansard":             1800,  // 30 min — parliamentary data updates infrequently
  "/api/murder-monitoring":   3600,  // 1 hr — TGEU data updates rarely
  "/api/trans-rights-index":  3600,  // 1 hr — index data is slow-changing
  "/api/archive":             1800,  // 30 min — Wayback data
};
const API_CACHE_DEFAULT_TTL = 300;   // 5 min fallback for unlisted endpoints

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      return handleApiRequest(request, url, env, ctx);
    }

    return handleStaticRequest(request, url);
  },
};

async function handleApiRequest(request, url, env, ctx) {
  // Only cache GET/HEAD — pass through mutations immediately
  if (!["GET", "HEAD"].includes(request.method)) {
    return fetchFromApi(request, url, env);
  }

  // Never cache explicit refresh requests
  if (url.searchParams.get("refresh") === "1") {
    return fetchFromApi(request, url, env);
  }

  const cache = caches.default;
  // Use the full URL as cache key (includes query params)
  const cacheKey = new Request(url.toString(), { method: "GET" });

  // 1. Check edge cache
  let cached = await cache.match(cacheKey);
  if (cached) {
    const resp = new Response(cached.body, cached);
    resp.headers.set("x-cache", "HIT");
    return resp;
  }

  // 2. Cache miss — fetch from Lambda
  const response = await fetchFromApi(request, url, env);

  // 3. Only cache successful responses
  if (response.status !== 200) {
    return response;
  }

  // 4. Determine TTL for this path
  const basePath = matchApiPath(url.pathname);
  const ttl = API_CACHE_TTL[basePath] ?? API_CACHE_DEFAULT_TTL;

  // 5. Clone response, add cache headers, store at edge
  const respHeaders = new Headers(response.headers);
  respHeaders.set("cache-control", `public, max-age=${ttl}, stale-while-revalidate=${ttl * 2}`);
  respHeaders.set("x-cache", "MISS");
  respHeaders.set("x-cache-ttl", `${ttl}`);

  const cacheable = new Response(response.clone().body, {
    status: response.status,
    headers: respHeaders,
  });

  // Store in edge cache (non-blocking)
  ctx.waitUntil(cache.put(cacheKey, cacheable.clone()));

  return cacheable;
}

function matchApiPath(pathname) {
  // Match against known paths (handles sub-paths like /api/news/latest)
  for (const path of Object.keys(API_CACHE_TTL)) {
    if (pathname === path || pathname.startsWith(path + "/")) {
      return path;
    }
  }
  return null;
}

async function fetchFromApi(request, url, env) {
  const apiPath = url.pathname.slice(4);
  const target = new URL(apiPath + url.search, API_GATEWAY);
  const apiRequest = new Request(target.toString(), {
    method:  request.method,
    headers: new Headers(request.headers),
    body:    ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
    redirect: "follow",
  });
  apiRequest.headers.set("x-origin-verify", env.ORIGIN_VERIFY_SECRET);
  apiRequest.headers.set("x-forwarded-for", request.headers.get("cf-connecting-ip") ?? "");

  const response = await fetch(apiRequest);
  const respHeaders = new Headers(response.headers);
  respHeaders.delete("x-amz-id-2");
  respHeaders.delete("x-amz-request-id");
  respHeaders.delete("x-amz-cf-id");
  respHeaders.delete("x-amz-cf-pop");
  addSecurityHeaders(respHeaders);

  return new Response(response.body, { status: response.status, headers: respHeaders });
}

async function handleStaticRequest(request, url) {
  const staticTarget = new URL(url.pathname + url.search, "http://" + S3_ORIGIN);
  const staticHeaders = new Headers(request.headers);
  staticHeaders.set("host", S3_ORIGIN);
  const staticRequest = new Request(staticTarget.toString(), {
    method:  request.method,
    headers: staticHeaders,
  });
  let cfCache = undefined;

  if (url.pathname === "/" || url.pathname === "/index.html") {
    cfCache = { cacheEverything: true, cacheTtl: 60 };
  } else if (url.pathname.startsWith("/assets/")) {
    cfCache = { cacheEverything: true, cacheTtl: 31536000 };
  } else if (!NO_CACHE_PATHS.has(url.pathname)) {
    cfCache = { cacheEverything: true, cacheTtl: 300 };
  }

  const staticResponse = cfCache
    ? await fetch(staticRequest, { cf: cfCache })
    : await fetch(staticRequest);
  const respHeaders = new Headers(staticResponse.headers);
  respHeaders.delete("x-amz-id-2");
  respHeaders.delete("x-amz-request-id");
  respHeaders.delete("x-amz-cf-id");
  respHeaders.delete("x-amz-cf-pop");
  addSecurityHeaders(respHeaders);

  if (NO_CACHE_PATHS.has(url.pathname)) {
    respHeaders.set("cache-control", "no-cache, no-store, must-revalidate");
    respHeaders.set("pragma", "no-cache");
  } else if (SHORT_CACHE_PATHS.has(url.pathname)) {
    respHeaders.set("cache-control", "public, max-age=60, stale-while-revalidate=300");
    respHeaders.delete("pragma");
  } else if (url.pathname.startsWith("/assets/")) {
    respHeaders.set("cache-control", "public, max-age=31536000, immutable");
    respHeaders.delete("pragma");
  } else {
    respHeaders.set("cache-control", "public, max-age=300");
    respHeaders.delete("pragma");
  }

  return new Response(staticResponse.body, { status: staticResponse.status, headers: respHeaders });
}

function addSecurityHeaders(headers) {
  headers.set("X-Content-Type-Options",  "nosniff");
  headers.set("X-Frame-Options",         "DENY");
  headers.set("Referrer-Policy",         "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy",      "geolocation=(), camera=(), microphone=()");
  headers.set("Content-Security-Policy", [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval' https://cdnjs.cloudflare.com https://static.cloudflareinsights.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "connect-src 'self' https://trans-news.com/api/ https://cdnjs.cloudflare.com https://cloudflareinsights.com",
    "img-src 'self' data: blob:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; "));
}
