const API_GATEWAY = "https://8soi33z3h9.execute-api.eu-west-1.amazonaws.com/";
const S3_ORIGIN   = "transmonitor-prod-static.s3-website-eu-west-1.amazonaws.com";
const NO_CACHE_PATHS = new Set(["/sw.js"]);
const SHORT_CACHE_PATHS = new Set(["/", "/index.html"]);

// API edge-cache TTLs (seconds) — only GET/HEAD are cached
const API_CACHE_TTL = {
  "/api/digest":                              300,   // 5 min — main feed digest
  "/api/news/v1/list-feed-digest":            300,   // 5 min — news feed
  "/api/news/v1/list-temporal-anomalies":     600,   // 10 min
  "/api/news/v1/summarize-article-cache":     1800,  // 30 min — cached summaries
  "/api/news/v1/get-summarize-article-cache": 1800,  // 30 min
  "/api/news/v1/sentiment-stats":             600,   // 10 min
  "/api/rights":                              3600,  // 1 hr — slow-changing index
  "/api/tmm/v1/get-data":                     3600,  // 1 hr — TGEU data
  "/api/media/v1/sources":                    900,   // 15 min — media bias list
  "/api/media/v1/source":                     900,   // 15 min — per-source bias
  "/api/rss-proxy":                           300,   // 5 min — RSS feeds
  "/api/health":                              30,    // 30s
};
const API_CACHE_DEFAULT_TTL = 300;

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
  if (!["GET", "HEAD"].includes(request.method)) {
    return fetchFromApi(request, url, env);
  }

  const cache = caches.default;
  const cacheKey = new Request(url.toString(), { method: "GET" });

  let cached = await cache.match(cacheKey);
  if (cached) {
    const resp = new Response(cached.body, cached);
    resp.headers.set("x-cache", "HIT");
    return resp;
  }

  const response = await fetchFromApi(request, url, env);

  if (response.status !== 200) {
    return response;
  }

  const basePath = matchApiPath(url.pathname);
  const ttl = API_CACHE_TTL[basePath] ?? API_CACHE_DEFAULT_TTL;

  const respHeaders = new Headers(response.headers);
  respHeaders.set("cache-control", `public, max-age=$${ttl}, stale-while-revalidate=$${ttl * 2}`);
  respHeaders.set("x-cache", "MISS");
  respHeaders.set("x-cache-ttl", `$${ttl}`);

  const cacheable = new Response(response.clone().body, {
    status: response.status,
    headers: respHeaders,
  });

  ctx.waitUntil(cache.put(cacheKey, cacheable.clone()));
  return cacheable;
}

function matchApiPath(pathname) {
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
  } else if (!url.pathname.startsWith("/api/") && !NO_CACHE_PATHS.has(url.pathname)) {
    cfCache = { cacheEverything: true, cacheTtl: 300 };
  }
  const staticResponse = cfCache
    ? await fetch(staticRequest, { cf: cfCache })
    : await fetch(staticRequest);
  const respHeaders = new Headers(staticResponse.headers);
  addSecurityHeaders(respHeaders);
  if (NO_CACHE_PATHS.has(url.pathname)) {
    respHeaders.set("Cache-Control", "no-cache, no-store, must-revalidate");
    respHeaders.set("Pragma", "no-cache");
  } else if (SHORT_CACHE_PATHS.has(url.pathname)) {
    respHeaders.set("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    respHeaders.delete("Pragma");
  } else if (url.pathname.startsWith("/assets/")) {
    respHeaders.set("Cache-Control", "public, max-age=31536000, immutable");
    respHeaders.delete("Pragma");
  } else {
    respHeaders.set("Cache-Control", "public, max-age=300");
    respHeaders.delete("Pragma");
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
