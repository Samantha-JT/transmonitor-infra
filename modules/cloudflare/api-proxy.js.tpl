const API_GATEWAY = "${api_gateway_url}";
const SECRET      = "${origin_verify_secret}";

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // No-cache for service worker and index files
    if (url.pathname === '/sw.js' || url.pathname === '/index.html' || url.pathname.includes('/workbox-')) {
      const originResp = await fetch(request, { cf: { cacheEverything: false, cacheTtl: 0 } });
      const resp = new Response(originResp.body, originResp);
      resp.headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      resp.headers.set('Pragma', 'no-cache');
      return resp;
    }

        if (!url.pathname.startsWith("/api/")) {
      return fetch(request);
    }

    const stripped = url.pathname.replace(/^\/api/, "") || "/";
    const target = new URL(stripped + url.search, API_GATEWAY);

    const headers = new Headers(request.headers);
    headers.set("x-origin-verify", SECRET);

    return fetch(target.toString(), {
      method:  request.method,
      headers: headers,
      body:    request.method !== "GET" && request.method !== "HEAD"
                 ? request.body
                 : undefined,
    });
  }
};
