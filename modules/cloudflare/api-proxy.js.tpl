const API_GATEWAY = "https://8soi33z3h9.execute-api.eu-west-1.amazonaws.com/";
const S3_ORIGIN   = "transmonitor-prod-static.s3-website-eu-west-1.amazonaws.com";
const NO_CACHE_PATHS = new Set(["/sw.js", "/index.html", "/"]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
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

    const staticTarget = new URL(url.pathname + url.search, "http://" + S3_ORIGIN);
    const staticRequest = new Request(staticTarget.toString(), {
      method:  request.method,
      headers: request.headers,
    });
    const staticResponse = await fetch(staticRequest);
    const respHeaders    = new Headers(staticResponse.headers);
    addSecurityHeaders(respHeaders);

    if (NO_CACHE_PATHS.has(url.pathname)) {
      respHeaders.set("Cache-Control", "no-cache, no-store, must-revalidate");
      respHeaders.set("Pragma", "no-cache");
    }

    return new Response(staticResponse.body, { status: staticResponse.status, headers: respHeaders });
  },
};

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
