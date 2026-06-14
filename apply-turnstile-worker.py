#!/usr/bin/env python3
"""Apply Turnstile challenge-verify rework to security-worker.js.
Idempotent-ish: aborts if anchors aren't found exactly once."""
import sys

f = "modules/cloudflare/security-worker.js"
s = open(f).read()

edits = [
# Edit 1: clearance check + verify route, after the already-blocked block
(
'''    // ── Fast path: already blocked ────────────────────────────────────────────
    const alreadyBlocked = await env.SECURITY_KV.get(`ip:${ip}:blocked`);
    if (alreadyBlocked) {
      return blockResponse("Previously blocked IP");
    }''',
'''    // ── Fast path: already blocked ────────────────────────────────────────────
    const alreadyBlocked = await env.SECURITY_KV.get(`ip:${ip}:blocked`);
    if (alreadyBlocked) {
      return blockResponse("Previously blocked IP");
    }

    // ── Turnstile verify endpoint ─────────────────────────────────────────────
    if (earlyPath === "/__turnstile_verify" && request.method === "POST") {
      return handleTurnstileVerify(request, env, ip);
    }

    // ── Fast path: passed a Turnstile challenge recently ──────────────────────
    const cleared = await env.SECURITY_KV.get(`ip:${ip}:cleared`);
    if (cleared) {
      return env.API_PROXY ? env.API_PROXY.fetch(request) : fetch(request);
    }''',
),
# Edit 2: replace dead-end 403 with challenge page
(
'''      return new Response(JSON.stringify({ error: "Access denied" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });''',
'''      return challengePage(env, new URL(request.url).pathname + new URL(request.url).search);''',
),
# Edit 3: helpers after blockResponse
(
'''function blockResponse(reason) {
  return new Response(
    JSON.stringify({ error: "Access denied", reason }),
    { status: 403, headers: { "Content-Type": "application/json" } }
  );
}''',
'''function blockResponse(reason) {
  return new Response(
    JSON.stringify({ error: "Access denied", reason }),
    { status: 403, headers: { "Content-Type": "application/json" } }
  );
}

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
    await Promise.all([
      env.SECURITY_KV.put(`ip:${ip}:cleared`, "1", { expirationTtl: 3600 }),
      env.SECURITY_KV.delete(`ip:${ip}:count`),
    ]);
    return new Response(JSON.stringify({ success: true }),
      { headers: { "Content-Type": "application/json" } });
  }
  return new Response(JSON.stringify({ success: false, error: "challenge failed" }),
    { status: 403, headers: { "Content-Type": "application/json" } });
}''',
),
]

for i, (old, new) in enumerate(edits, 1):
    n = s.count(old)
    if n != 1:
        print(f"ABORT: edit {i} anchor found {n} times (expected 1). No changes written.")
        sys.exit(1)
    s = s.replace(old, new)

open(f, "w").write(s)
print("All 3 edits applied cleanly.")
