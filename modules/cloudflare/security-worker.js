/**
 * TransMonitor Intelligent Security Worker
 * Standalone WAF layer — runs first via Cloudflare route priority.
 * Forwards clean requests to api-proxy via service binding (no route conflict).
 * Scores ambiguous requests via Bedrock through existing API Gateway Lambda.
 *
 * Environment bindings (Terraform / wrangler.toml):
 *   SECURITY_KV       - Workers KV namespace (request tracking)
 *   API_PROXY         - Service binding to api-proxy worker
 *   CF_ZONE_ID        - Cloudflare zone ID
 *   PUSHOVER_TOKEN    - Pushover application token
 *   SCORE_ENDPOINT    - API GW URL e.g. https://8soi33z3h9.execute-api.eu-west-1.amazonaws.com/security/score
 *   ORIGIN_VERIFY_SECRET - Same secret used by all Lambda calls
 *   HOSTNAME          - trans-news.com
 *
 * KV key schema:
 *   ip:{ip}:count     - request count, TTL 300s
 *   ip:{ip}:blocked   - block flag, TTL 86400s
 */

// ── Constants ─────────────────────────────────────────────────────────────────

// Whitelist — never block these IPs.
// NOTE: home IP is DYNAMIC, so this entry goes stale on every ISP lease change
// and cannot be relied on for dev access. The real lockout fix is the
// static-asset rate-counting skip below; this list is only for genuinely
// fixed IPs. Update if your current address changes, or use a KV allow key.
const WHITELISTED_IPS = new Set([
  "84.247.40.149", // home (dynamic — may go stale)
]);

// ── Cookie-based clearance (IP-independent) ────────────────────────────
// Clearance keyed on IP breaks for dynamic residential IPs: the user is
// re-challenged on every IP rotation. A signed cookie travels with the browser
// regardless of IP, so one solved challenge clears the visitor for its TTL.
//
// GDPR/ePrivacy: tm_cleared is a STRICTLY NECESSARY security cookie (bot-
// challenge clearance). It sets no tracking/analytics/profiling data, is
// HttpOnly + HMAC-signed, and is required to deliver the service the user
// requested. Per ICO/EDPB guidance this category is exempt from consent — no
// cookie banner required. (Functionally equivalent to Cloudflare's own
// cf_clearance cookie.) See privacy policy entry for tm_cleared.
const CLEARANCE_COOKIE = "tm_cleared";
const CLEARANCE_TTL_SECS = 7 * 86400;   // 7 days

function b64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function signClearance(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return b64url(sig);
}

async function makeClearanceCookie(secret) {
  const value = String(Date.now() + CLEARANCE_TTL_SECS * 1000);  // expiry ms
  const sig = await signClearance(value, secret);
  return `${value}.${sig}`;
}

async function verifyClearanceCookie(cookieHeader, secret) {
  if (!cookieHeader || !secret) return false;
  const m = cookieHeader.match(new RegExp(CLEARANCE_COOKIE + "=([^;]+)"));
  if (!m) return false;
  const dot = m[1].lastIndexOf(".");
  if (dot < 0) return false;
  const value = m[1].slice(0, dot);
  const sig = m[1].slice(dot + 1);
  if (!/^\d+$/.test(value) || Number(value) < Date.now()) return false;  // expired/malformed
  const expected = await signClearance(value, secret);
  if (sig.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

const THRESHOLDS = {
  RATE_LIMIT_WINDOW_SECS: 300,
  RATE_LIMIT_BLOCK:       100,
  RATE_LIMIT_CHALLENGE:   80,   // raised from 40: one dashboard view makes many API calls
  SCORE_BLOCK:            80,
  SCORE_CHALLENGE:        50,
  CF_THREAT_BLOCK:        25,
};

const BAD_ASNS = new Set([
  14061, 16276, 24940, 51167, 20473,
  8100,  9009,  60068, 136907, 45102,
]);

const BAD_ASN_ORG_PATTERNS = [
  /hosting/i, /datacenter/i, /data\s*center/i,
  /\bvps\b/i, /colocation/i, /dedicated\s*server/i,
];

const SCANNER_PATHS = [
  /\/\.env(\.|$|\?)/,
  /\/wp-config/,
  /\/\.git\//,
  /\/backup\//,
  /\/phpMyAdmin/i,
  /\/admin\/config/,
  /\/config\.php/,
  /\/\.aws\//,
  /\/credentials/,
  /\/proc\/self/,
  /\/etc\/passwd/,
  /\.env\.(prod|staging|local|sample|old|dist|backup)/,
  /\/laravel/i,
  /\/workbox-[a-f0-9]+\.js$/,
  /\/sw\.js\.map$/,
  /\/xmlrpc\.php$/,
  /\/shell\.php/i,
  /\/c99\.php/i,
];

const BAD_UA_PATTERNS = [
  /^curl\//i, /^python-requests/i, /^go-http-client/i,
  /^axios\//i, /^libwww-perl/i, /^masscan/i,
  /^zgrab/i, /^nuclei/i, /^sqlmap/i, /^nikto/i,
  /^dirbuster/i, /^nmap/i, /^\s*$/,
];

const HIGH_RISK_COUNTRIES = new Set(["CN", "RU", "KP", "IR", "BY"]);

// ── Main handler ──────────────────────────────────────────────────────────────

export default {
  async fetch(request, env, ctx) {
    const cf       = request.cf ?? {};
    const ip       = request.headers.get("CF-Connecting-IP") ?? "unknown";

    if (WHITELISTED_IPS.has(ip)) {
      return env.API_PROXY ? env.API_PROXY.fetch(request) : fetch(request);
    }

    // ── Fast path: static assets bypass scoring + rate counting ───────────────
    // The SPA shell, JS/CSS bundles, fonts and images are the bulk of a
    // legitimate page load. Counting them toward the per-IP rate limit means a
    // single human viewing the dashboard burns the budget in one visit (this
    // is what caused false-positive 403 lockouts). Pass them straight through.
    // NOTE: scanner paths (.env, shell.php, wp-config, etc.) do not match these
    // static extensions, so scanner detection is unaffected.
    const earlyPath = new URL(request.url).pathname;
    if (
      earlyPath.startsWith("/assets/") ||
      /\.(?:js|css|map|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|eot)$/i.test(earlyPath)
    ) {
      return env.API_PROXY ? env.API_PROXY.fetch(request) : fetch(request);
    }

    // ── Fast path: valid clearance cookie (IP-independent) ───────────────
    // A browser that solved a Turnstile challenge carries a signed tm_cleared
    // cookie; honour it regardless of the (possibly rotated) source IP.
    if (await verifyClearanceCookie(request.headers.get("Cookie"), env.ORIGIN_VERIFY_SECRET)) {
      return env.API_PROXY ? env.API_PROXY.fetch(request) : fetch(request);
    }

    const country  = cf.country ?? request.headers.get("CF-IPCountry") ?? "XX";
    const asn      = cf.asn ?? null;
    const asnOrg   = cf.asOrganization ?? "";
    const cfThreat = Number(cf.threatScore ?? 0);
    const ua       = request.headers.get("User-Agent") ?? "";
    const path     = new URL(request.url).pathname;

    // ── Fast path: already blocked ────────────────────────────────────────────
    const alreadyBlocked = await env.SECURITY_KV.get(`ip:${ip}:blocked`);
    if (alreadyBlocked) {
      return blockResponse("Previously blocked IP");
    }

    // ── Turnstile verify endpoint ─────────────────────────────────────────────
    // The challenge page (below) POSTs the solved token here. On success we
    // write a short-lived clearance key so subsequent requests from this IP
    // pass without re-challenged.
    if (earlyPath === "/__turnstile_verify" && request.method === "POST") {
      return handleTurnstileVerify(request, env, ip);
    }

    // ── Fast path: passed a Turnstile challenge recently ──────────────────────
    const cleared = await env.SECURITY_KV.get(`ip:${ip}:cleared`);
    if (cleared) {
      return env.API_PROXY ? env.API_PROXY.fetch(request) : fetch(request);
    }

    // ── Fast path: Cloudflare threat intelligence ─────────────────────────────
    if (cfThreat > THRESHOLDS.CF_THREAT_BLOCK) {
      ctx.waitUntil(Promise.all([
        env.SECURITY_KV.put(`ip:${ip}:blocked`, "1", { expirationTtl: 86400 }),
        pushoverAlert({ action: "block", ip, country, asn, asnOrg, score: cfThreat, reasons: [`CF threat score: ${cfThreat}`], rateCount: 0, source: "cf-threat-score" }, env),
      ]));
      return blockResponse(`CF threat score: ${cfThreat}`);
    }

    // ── Fast scoring (no I/O) ─────────────────────────────────────────────────
    const { score, reasons } = fastScore({ ip, country, asn, asnOrg, ua, path });

    // ── Rate limiting via KV ──────────────────────────────────────────────────
    const rateKey   = `ip:${ip}:count`;
    const rateCount = await incrementKV(env.SECURITY_KV, rateKey, THRESHOLDS.RATE_LIMIT_WINDOW_SECS);

    let action = "pass";
    if (score >= THRESHOLDS.SCORE_BLOCK || rateCount >= THRESHOLDS.RATE_LIMIT_BLOCK) {
      action = "block";
    } else if (score >= THRESHOLDS.SCORE_CHALLENGE || rateCount >= THRESHOLDS.RATE_LIMIT_CHALLENGE) {
      action = "challenge";
    }

    // ── Medium confidence: score via Bedrock Lambda async ─────────────────────
    if (action === "challenge" && score < 70) {
      ctx.waitUntil(
        bedrockScore({ ip, country, asn, asnOrg, ua, path, rateCount, cfThreat, reasons }, env)
          .then(result => {
            if (result.score >= THRESHOLDS.SCORE_BLOCK) {
              return Promise.all([
                env.SECURITY_KV.put(`ip:${ip}:blocked`, "1", { expirationTtl: 86400 }),
                pushoverAlert({
                  action: "block", ip, country, asn, asnOrg,
                  score: result.score,
                  reasons: [result.reasoning],
                  rateCount,
                  source: "bedrock-async",
                }, env),
              ]);
            }
          })
          .catch(err => console.error("Bedrock async scoring failed:", err))
      );
    }

    // ── Execute action ────────────────────────────────────────────────────────
    if (action === "block") {
      ctx.waitUntil(Promise.all([
        env.SECURITY_KV.put(`ip:${ip}:blocked`, "1", { expirationTtl: 86400 }),
        pushoverAlert({ action: "block", ip, country, asn, asnOrg, score, reasons, rateCount, source: "fast-path" }, env),
      ]));
      return blockResponse(reasons[0] ?? "Security policy");
    }

    if (action === "challenge") {
      ctx.waitUntil(
        pushoverAlert({ action: "challenge", ip, country, asn, asnOrg, score, reasons, rateCount, source: "fast-path" }, env)
      );
      return challengePage(env, new URL(request.url).pathname + new URL(request.url).search);
    }

    // ── Pass through via service binding ──────────────────────────────────────
    if (env.API_PROXY) {
      const cleanHeaders = new Headers(request.headers);
      cleanHeaders.set("host", env.HOSTNAME);
      const cleanRequest = new Request(request.url, {
        method:  request.method,
        headers: cleanHeaders,
        body:    ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
        redirect: "follow",
      });

      const response = await env.API_PROXY.fetch(cleanRequest);
      const url = new URL(request.url);

      // Strip S3 origin headers that leak infrastructure info
      const cleanResponse = new Response(response.body, response);
      cleanResponse.headers.delete("x-amz-id-2");
      cleanResponse.headers.delete("x-amz-request-id");
      cleanResponse.headers.delete("x-amz-cf-id");
      cleanResponse.headers.delete("x-amz-cf-pop");

      if (url.pathname.startsWith("/assets/")) {
        cleanResponse.headers.set("cache-control", "public, max-age=31536000, immutable");
        return cleanResponse;
      }


      return cleanResponse;
    }

    return fetch(request);
  },
};

// ── Fast scoring ──────────────────────────────────────────────────────────────

function fastScore({ ip, country, asn, asnOrg, ua, path }) {
  let score     = 0;
  const reasons = [];

  for (const pattern of SCANNER_PATHS) {
    if (pattern.test(path)) {
      score += 60;
      reasons.push(`Scanner path: ${path}`);
      break;
    }
  }

  for (const pattern of BAD_UA_PATTERNS) {
    if (pattern.test(ua)) {
      score += 30;
      reasons.push(`Suspicious UA: ${ua.slice(0, 80)}`);
      break;
    }
  }

  if (asn !== null && BAD_ASNS.has(asn)) {
    score += 25;
    reasons.push(`Hosting ASN: ${asn} (${asnOrg})`);
  } else if (asnOrg) {
    for (const pattern of BAD_ASN_ORG_PATTERNS) {
      if (pattern.test(asnOrg)) {
        score += 15;
        reasons.push(`Hosting org: ${asnOrg}`);
        break;
      }
    }
  }

  if (HIGH_RISK_COUNTRIES.has(country)) {
    score += 15;
    reasons.push(`High-risk country: ${country}`);
  }

  if (ip === "185.177.72.12" || ip === "185.177.72.54") {
    score += 100;
    reasons.push(`Known attacker IP: ${ip}`);
  }

  return { score: Math.min(score, 100), reasons };
}

// ── Bedrock scoring via API Gateway Lambda ────────────────────────────────────

async function bedrockScore({ ip, country, asn, asnOrg, ua, path, rateCount, cfThreat, reasons }, env) {
  if (!env.SCORE_ENDPOINT || !env.ORIGIN_VERIFY_SECRET) {
    console.warn("SCORE_ENDPOINT or ORIGIN_VERIFY_SECRET not configured — skipping Bedrock score");
    return { score: 0, reasoning: "Scoring not configured" };
  }

  try {
    const res = await fetch(env.SCORE_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type":    "application/json",
        "x-origin-verify": env.ORIGIN_VERIFY_SECRET,
      },
      body: JSON.stringify({ ip, country, asn, asnOrg, ua, path, rateCount, cfThreat, reasons }),
    });

    if (!res.ok) {
      console.error("Score endpoint returned", res.status);
      return { score: 0, reasoning: "Scoring endpoint error" };
    }

    const data = await res.json();
    return {
      score:     Math.min(100, Math.max(0, Number(data.score ?? 0))),
      reasoning: String(data.reasoning ?? "No reasoning").slice(0, 100),
    };
  } catch (err) {
    console.error("Bedrock score fetch failed:", err);
    return { score: 0, reasoning: "Scoring failed — defaulting safe" };
  }
}

// ── Pushover alert ───────────────────────────────────────────────────────────

async function pushoverAlert({ action, ip, country, asn, asnOrg, score, reasons, rateCount, source }, env) {
  if (!env.PUSHOVER_TOKEN || !env.PUSHOVER_USER) return;
  const emoji   = action === "block" ? "🚫" : "⚠️";
  const priority = action === "block" ? 1 : 0;
  const title   = `${emoji} TransMonitor: ${action.toUpperCase()}`;
  const message = [
    `<b>IP:</b> ${ip} (${country})`,
    `<b>ASN:</b> ${asn} — ${asnOrg || "unknown"}`,
    `<b>Score:</b> ${score}/100`,
    `<b>Req/5min:</b> ${rateCount}`,
    `<b>Source:</b> ${source}`,
    `<b>Reasons:</b> ${(Array.isArray(reasons) ? reasons : [reasons]).join(", ") || "rate limit exceeded"}`,
  ].join("\n");
  try {
    await fetch("https://api.pushover.net/1/messages.json", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token:    env.PUSHOVER_TOKEN,
        user:     env.PUSHOVER_USER,
        title,
        message,
        priority,
        html:     1,
      }),
    });
  } catch (err) {
    console.error("Pushover alert failed:", err);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function blockResponse(reason) {
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Access blocked \u2014 TransMonitor</title>
<style>
  body{font-family:system-ui,-apple-system,sans-serif;background:#0d1117;color:#e6edf3;
       display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:1.5rem}
  .box{text-align:center;max-width:40rem}
  .flag{font-size:3rem;line-height:1;margin-bottom:1.25rem}
  h1{font-size:1.875rem;font-weight:700;margin:0 0 1.25rem}
  p{color:#9da7b3;font-size:1.15rem;line-height:1.7;margin:0 0 1rem}
  .human{background:#161b22;border:1px solid #30363d;border-radius:.6rem;padding:1.5rem 1.75rem;
         margin:1.75rem 0;text-align:left}
  .human strong{color:#e6edf3;font-size:1.2rem}
  .human p{font-size:1.1rem}
  .bot{color:#7d8590;font-size:1rem;font-style:italic;margin-top:1.75rem}
  .ref{color:#586069;font-size:.85rem;margin-top:2rem;font-family:ui-monospace,monospace}
</style></head>
<body><div class="box">
  <div class="flag">\ud83c\udff3\ufe0f\u200d\u26a7\ufe0f</div>
  <h1>Well, this is awkward.</h1>
  <p>Our overly-suspicious robot bouncer flagged your connection and shut the
     door. It does this sometimes to perfectly lovely humans.</p>
  <div class="human">
    <p style="margin:0 0 .75rem"><strong>If you're a real person \u2014 this is probably a mistake, and we're sorry.</strong></p>
    <p style="margin:0">Shared networks, VPNs, Tor and other privacy tools can trip the
       filter \u2014 and those are exactly the things many of our readers rely on to stay
       safe. The block clears on its own within 24 hours. If you're in a hurry, try
       again from a different network, or with your VPN toggled, and you'll likely
       sail straight through.</p>
  </div>
  <p class="bot">If, on the other hand, you're a bot scraping the site: respectfully,
     transition to a better hobby. \ud83d\udc85</p>
  <p class="ref">TransMonitor security \u00b7 ref: ${(reason || "policy").toString().slice(0, 80)}</p>
</div></body></html>`;
  return new Response(html, {
    status: 403,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

// ── Turnstile challenge page ────────────────────────────────────────────────
// Served instead of a dead-end 403 when a request is flagged. A real human
// solves the (usually invisible) widget; on success the inline script POSTs
// the token to /__turnstile_verify, which sets a clearance key, then reloads
// the original URL.
function challengePage(env, returnTo) {
  const sitekey = env.TURNSTILE_SITEKEY ?? "";
  const safeReturn = (returnTo && returnTo.startsWith("/")) ? returnTo : "/";
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Verifying your browser…</title>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
<style>
  body{font-family:system-ui,-apple-system,sans-serif;background:#0d1117;color:#e6edf3;
       display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
  .box{text-align:center;max-width:28rem;padding:2rem}
  h1{font-size:1.25rem;font-weight:600;margin:0 0 .5rem}
  p{color:#8b949e;font-size:.9rem;line-height:1.5}
  .cf-turnstile{margin:1.5rem auto 0;display:flex;justify-content:center}
</style></head>
<body><div class="box">
  <h1>Just checking you're human</h1>
  <p>This site monitors trans rights coverage and sees a lot of automated traffic.
     One quick check and you'll be through — no puzzles.</p>
  <div class="cf-turnstile" data-sitekey="${sitekey}" data-callback="onSolved"></div>
  <p id="status"></p>
</div>
<script>
  function onSolved(token){
    document.getElementById('status').textContent='Verifying…';
    fetch('/__turnstile_verify',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({token:token})})
      .then(function(r){return r.json()})
      .then(function(d){
        if(d && d.success){ window.location.replace(${JSON.stringify(safeReturn)}); }
        else { document.getElementById('status').textContent='Verification failed — please refresh to try again.'; }
      })
      .catch(function(){ document.getElementById('status').textContent='Verification error — please refresh.'; });
  }
</script>
</body></html>`;
  return new Response(html, {
    status: 403,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

// ── Turnstile token verification ────────────────────────────────────────────
async function handleTurnstileVerify(request, env, ip) {
  let token = "";
  try {
    const body = await request.json();
    token = body && body.token ? body.token : "";
  } catch {
    return new Response(JSON.stringify({ success: false, error: "bad request" }),
      { status: 400, headers: { "Content-Type": "application/json" } });
  }
  if (!token) {
    return new Response(JSON.stringify({ success: false, error: "missing token" }),
      { status: 400, headers: { "Content-Type": "application/json" } });
  }

  const form = new URLSearchParams();
  form.set("secret", env.TURNSTILE_SECRET ?? "");
  form.set("response", token);
  if (ip && ip !== "unknown") form.set("remoteip", ip);

  let outcome = { success: false };
  try {
    const resp = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    outcome = await resp.json();
  } catch (err) {
    console.error("siteverify call failed:", err);
    return new Response(JSON.stringify({ success: false, error: "verify failed" }),
      { status: 502, headers: { "Content-Type": "application/json" } });
  }

  if (outcome.success) {
    // Clearance for this IP — 1 hour. Also clear the rate counter so the
    // immediate next requests after solving don't instantly re-trip the limit.
    await Promise.all([
      env.SECURITY_KV.put(`ip:${ip}:cleared`, "1", { expirationTtl: 3600 }),
      env.SECURITY_KV.delete(`ip:${ip}:count`),
    ]);
    const clearanceCookie = await makeClearanceCookie(env.ORIGIN_VERIFY_SECRET);
    return new Response(JSON.stringify({ success: true }),
      { headers: {
          "Content-Type": "application/json",
          "Set-Cookie": `${CLEARANCE_COOKIE}=${clearanceCookie}; Path=/; Max-Age=${CLEARANCE_TTL_SECS}; HttpOnly; Secure; SameSite=Lax`,
        } });
  }
  return new Response(JSON.stringify({ success: false, error: "challenge failed" }),
    { status: 403, headers: { "Content-Type": "application/json" } });
}

async function incrementKV(kv, key, ttl) {
  const current = await kv.get(key);
  const count   = parseInt(current ?? "0", 10) + 1;
  await kv.put(key, String(count), { expirationTtl: ttl });
  return count;
}
