/**
 * TransMonitor Intelligent Security Worker
 * Standalone WAF layer — runs first via Cloudflare route priority.
 * Forwards clean requests to api-proxy via service binding (no route conflict).
 * Scores ambiguous requests via Bedrock through existing API Gateway Lambda.
 *
 * Environment bindings (Terraform / wrangler.toml):
 *   SECURITY_KV       - Workers KV namespace (request tracking)
 *   API_PROXY         - Service binding to api-proxy worker
 *   CF_API_TOKEN      - Cloudflare API token (Zone:Firewall Services:Edit)
 *   CF_ZONE_ID        - Cloudflare zone ID
 *   SLACK_WEBHOOK_URL - Slack incoming webhook
 *   SCORE_ENDPOINT    - API GW URL e.g. https://8soi33z3h9.execute-api.eu-west-1.amazonaws.com/security/score
 *   ORIGIN_VERIFY_SECRET - Same secret used by all Lambda calls
 *   HOSTNAME          - trans-news.com
 *
 * KV key schema:
 *   ip:{ip}:count     - request count, TTL 300s
 *   ip:{ip}:blocked   - block flag, TTL 86400s
 */

// ── Constants ─────────────────────────────────────────────────────────────────

// Whitelist — never block these IPs
const WHITELISTED_IPS = new Set([
  "84.247.43.123", // home
]);

const THRESHOLDS = {
  RATE_LIMIT_WINDOW_SECS: 300,
  RATE_LIMIT_BLOCK:       100,
  RATE_LIMIT_CHALLENGE:   40,
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

    // ── Fast path: Cloudflare threat intelligence ─────────────────────────────
    if (cfThreat > THRESHOLDS.CF_THREAT_BLOCK) {
      ctx.waitUntil(Promise.all([
        env.SECURITY_KV.put(`ip:${ip}:blocked`, "1", { expirationTtl: 86400 }),
        slackAlert({ action: "block", ip, country, asn, asnOrg, score: cfThreat, reasons: [`CF threat score: ${cfThreat}`], rateCount: 0, source: "cf-threat-score" }, env),
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
                addCloudflareFirewallRule(ip, result.reasoning, env),
                slackAlert({
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
        addCloudflareFirewallRule(ip, reasons.join(", "), env),
        slackAlert({ action: "block", ip, country, asn, asnOrg, score, reasons, rateCount, source: "fast-path" }, env),
      ]));
      return blockResponse(reasons[0] ?? "Security policy");
    }

    if (action === "challenge") {
      ctx.waitUntil(
        slackAlert({ action: "challenge", ip, country, asn, asnOrg, score, reasons, rateCount, source: "fast-path" }, env)
      );
      return new Response(JSON.stringify({ error: "Access denied" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
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

      if (url.pathname.startsWith("/api/news/") || url.pathname.startsWith("/api/media/")) {
        cleanResponse.headers.set("cache-control", "public, max-age=300, stale-while-revalidate=60");
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

// ── Cloudflare API: add firewall rule ─────────────────────────────────────────

async function addCloudflareFirewallRule(ip, reason, env) {
  if (!env.CF_API_TOKEN || !env.CF_ZONE_ID) return;
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${env.CF_ZONE_ID}/firewall/rules`,
      {
        method:  "POST",
        headers: {
          "Authorization": `Bearer ${env.CF_API_TOKEN}`,
          "Content-Type":  "application/json",
        },
        body: JSON.stringify([{
          filter:      { expression: `ip.src eq ${ip}` },
          action:      "block",
          description: `Auto-blocked by security worker: ${reason.slice(0, 90)}`,
        }]),
      }
    );
    if (!res.ok) console.error("CF firewall rule failed:", await res.text());
  } catch (err) {
    console.error("Failed to add CF firewall rule:", err);
  }
}

// ── Slack alert ───────────────────────────────────────────────────────────────

async function slackAlert({ action, ip, country, asn, asnOrg, score, reasons, rateCount, source }, env) {
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
  return new Response(
    JSON.stringify({ error: "Access denied", reason }),
    { status: 403, headers: { "Content-Type": "application/json" } }
  );
}

async function incrementKV(kv, key, ttl) {
  const current = await kv.get(key);
  const count   = parseInt(current ?? "0", 10) + 1;
  await kv.put(key, String(count), { expirationTtl: ttl });
  return count;
}
