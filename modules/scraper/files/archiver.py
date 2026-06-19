#!/usr/bin/env python3.11
"""
TransMonitor Article Archiver
==============================
Screenshots articles from the news digest and stores them to S3
with full metadata tagging and a local SQLite index.

Usage:
    python3 archiver.py run     # Archive pending URLs from Redis
    python3 archiver.py stats   # Show archive statistics
    python3 archiver.py search  # Search the archive index
"""

import sys, os, json, sqlite3, hashlib, re
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

import boto3
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout

# ── Config ────────────────────────────────────────────────────────────────────
ARCHIVE_BUCKET  = 'transmonitor-prod-archive'
REDIS_URL       = os.environ.get('REDIS_URL', '')
DB_PATH         = Path(__file__).parent / 'archive_index.db'
AWS_REGION      = 'eu-west-1'
SCREENSHOT_W    = 1280
MAX_SCROLL_H    = 12_000   # cap capture height (px) to bound Chromium memory on tall pages
REQUEST_TIMEOUT = 20_000   # ms
NAVIGATE_TIMEOUT= 45_000   # ms (raised: real publisher pages are ad-heavy/slow)

# Cookie banner selectors to auto-dismiss
COOKIE_SELECTORS = [
    'button[id*="accept"]',
    'button[class*="accept"]',
    'button[id*="agree"]',
    'button[class*="agree"]',
    'button[id*="consent"]',
    'button[class*="consent"]',
    '[aria-label*="Accept"]',
    '[aria-label*="accept"]',
    '#onetrust-accept-btn-handler',
    '.cc-accept',
    '.cookie-accept',
    'button:has-text("Accept all")',
    'button:has-text("Accept cookies")',
    'button:has-text("I agree")',
    'button:has-text("Got it")',
    'button:has-text("OK")',
    'button:has-text("Agree")',
    'button[title="Accept"]',
    'button[title="Accept all"]',
    '.message-component button[title*="Accept"]',
    'button[aria-label="Accept all"]',
    '.qc-cmp2-summary-buttons button[mode="primary"]',
    '#didomi-notice-agree-button',
    '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
    '#CybotCookiebotDialogBodyButtonAccept',
    '#truste-consent-button',
    'button:has-text("Accept All")',
    'button:has-text("I Accept")',
    'button:has-text("Allow all")',
]

# ── Database ──────────────────────────────────────────────────────────────────
def init_db(conn):
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS archive (
            id              TEXT PRIMARY KEY,
            url             TEXT NOT NULL,
            domain          TEXT,
            title           TEXT,
            source_name     TEXT,
            category        TEXT,
            article_date    TEXT,
            captured_at     TEXT,
            s3_key          TEXT,
            bias_label      TEXT,
            bias_score      INTEGER,
            file_size_bytes INTEGER,
            status          TEXT DEFAULT 'ok'
        );
        CREATE INDEX IF NOT EXISTS idx_domain   ON archive(domain);
        CREATE INDEX IF NOT EXISTS idx_date     ON archive(article_date);
        CREATE INDEX IF NOT EXISTS idx_category ON archive(category);
        CREATE INDEX IF NOT EXISTS idx_captured ON archive(captured_at);
    """)
    conn.commit()
    # Idempotent migration: add text + content-hash columns if absent.
    cols = {r[1] for r in conn.execute("PRAGMA table_info(archive)")}
    for col in ("text_s3_key", "image_sha256", "text_sha256", "text_len"):
        if col not in cols:
            coltype = "INTEGER" if col == "text_len" else "TEXT"
            conn.execute(f"ALTER TABLE archive ADD COLUMN {col} {coltype}")
    conn.commit()

# ── URL queue via Redis ───────────────────────────────────────────────────────
def get_pending_urls():
    """
    Read article URLs from S3 pending queue written by news-digest Lambda.
    """
    import boto3
    s3 = boto3.client('s3', region_name=AWS_REGION)
    try:
        obj = s3.get_object(Bucket=ARCHIVE_BUCKET, Key='pending/articles.json')
        articles = json.loads(obj['Body'].read())
        return [a for a in articles if a.get('url')]
    except Exception as e:
        print(f"Could not read pending articles from S3: {e}")
        return []

# ── Screenshot ────────────────────────────────────────────────────────────────
def _try_dismiss_in(frame):
    for selector in COOKIE_SELECTORS:
        try:
            el = frame.locator(selector).first
            if el.is_visible(timeout=500):
                el.click(timeout=2000)
                return True
        except Exception:
            continue
    return False

def dismiss_cookies(page):
    # Main frame + every child frame (Sourcepoint et al. use a cross-origin
    # iframe the main-frame locators can't see). Twice, for second prompts.
    for _ in range(2):
        clicked = _try_dismiss_in(page)
        for fr in page.frames:
            if fr == page.main_frame:
                continue
            try:
                if _try_dismiss_in(fr):
                    clicked = True
            except Exception:
                continue
        page.wait_for_timeout(500)
        if not clicked:
            break

def extract_text(page):
    """Readable text from the loaded page. Prefer article/main, fall back to body.
    No external deps — uses Playwright's rendered inner_text."""
    for sel in ('article', 'main', 'body'):
        try:
            loc = page.locator(sel).first
            if loc.count() > 0:
                txt = loc.inner_text(timeout=3000)
                if txt and len(txt.strip()) > 100:
                    return txt.strip()
        except Exception:
            continue
    return ''

GN_CONSENT_COOKIE = "CONSENT=YES+cb.20231231-07-p0.en+FX+410; SOCS=CAESEwgDEgk0ODE3Nzk3MjQaAmVuIAEaBgiA_LyaBg"

import time as _time
_last_gn_call = [0.0]  # module-level throttle clock

def _urlopen_retry(req, timeout=20, tries=3):
    """urlopen with retry on transient 503/429 (Google throttles batchexecute
    under rapid back-to-back calls). Also paces calls ~1.2s apart to stay under
    the rate limit in the first place."""
    import urllib.request, urllib.error
    for attempt in range(tries):
        # pace: ensure >=1.2s since the previous GN call
        gap = _time.time() - _last_gn_call[0]
        if gap < 1.2:
            _time.sleep(1.2 - gap)
        _last_gn_call[0] = _time.time()
        try:
            return urllib.request.urlopen(req, timeout=timeout)
        except urllib.error.HTTPError as e:
            if e.code in (503, 429) and attempt < tries - 1:
                _time.sleep(2 * (attempt + 1))  # 2s, 4s backoff
                continue
            raise

def resolve_google_news(url: str) -> str:
    """Resolve a news.google.com/rss/articles/ URL to the real publisher URL via
    Google's batchexecute endpoint. Returns the resolved URL, or the original URL
    on any failure (so capture still attempts something). The manifest is keyed on
    the ORIGINAL gn url regardless; only the captured content uses the resolved url.
    Reverse-engineered RPC; may break if Google changes the format — failures fall
    back to the original url (capturing the GN consent page, the prior behaviour)."""
    import urllib.request, urllib.parse
    if "news.google.com" not in url:
        return url
    m = re.search(r'/articles/([^?]+)', url)
    if not m:
        return url
    art_id = m.group(1)
    ua = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": ua, "Cookie": GN_CONSENT_COOKIE})
        html = _urlopen_retry(req).read().decode("utf-8", "replace")
        sg = re.search(r'data-n-a-sg="([^"]+)"', html)
        ts = re.search(r'data-n-a-ts="([^"]+)"', html)
        if not (sg and ts):
            return url
        inner = json.dumps([
            "garturlreq",
            [["X","X",["X","X"],None,None,1,1,"US:en",None,1,None,None,None,None,None,0,1],
             "X","X",1,[1,1,1],1,1,None,0,0,None,0],
            art_id, int(ts.group(1)), sg.group(1)
        ])
        freq = json.dumps([[["Fbv4je", inner, None, "generic"]]])
        body = urllib.parse.urlencode({"f.req": freq}).encode()
        req2 = urllib.request.Request(
            "https://news.google.com/_/DotsSplashUi/data/batchexecute",
            data=body,
            headers={"User-Agent": ua, "Cookie": GN_CONSENT_COOKIE,
                     "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"},
        )
        resp = _urlopen_retry(req2).read().decode("utf-8", "replace")
        urls = re.findall(r'(https?://(?!news\.google|www\.google|consent\.google)[^\\"\s]+)', resp)
        if urls:
            return urls[0]
    except Exception as e:
        print(f"    GN resolve failed ({e}); using original url")
    return url

def capture_url(page, url: str):
    """Returns (image_bytes, text) for the page, or (None, None) on failure.
    Text is captured in the same page visit as the screenshot so both come from
    the identical render. Text is always full, even when the screenshot is clipped."""
    try:
        real_url = resolve_google_news(url)
        if real_url != url:
            print(f"    resolved GN -> {real_url[:70]}")
        page.goto(real_url, wait_until='commit', timeout=NAVIGATE_TIMEOUT)
        page.wait_for_timeout(3500)  # let JS + CMP consent iframe render
        dismiss_cookies(page)
        page.wait_for_timeout(1200)  # let the banner animate out before capture

        text = extract_text(page)

        # Bound capture height to limit Chromium memory. full_page=True ignores
        # the viewport, so for tall pages we clip a fixed-height region from the top
        # instead of rendering the entire (possibly enormous) document. Text above
        # is always full regardless of the visual clip.
        height = page.evaluate("document.body.scrollHeight")
        if height > MAX_SCROLL_H:
            img = page.screenshot(
                type='jpeg', quality=85,
                clip={'x': 0, 'y': 0, 'width': SCREENSHOT_W, 'height': MAX_SCROLL_H},
            )
        else:
            img = page.screenshot(full_page=True, type='jpeg', quality=85)
        return img, text
    except PlaywrightTimeout:
        print(f"    timeout: {url[:80]}")
        return None, None
    except Exception as e:
        print(f"    error: {e} — {url[:80]}")
        return None, None

# ── S3 upload ─────────────────────────────────────────────────────────────────
def url_hash(url: str) -> str:
    return hashlib.sha256(url.encode()).hexdigest()[:16]

def s3_key(url: str, date: str) -> str:
    domain = urlparse(url).netloc.replace('www.', '')
    d = date[:10] if date else datetime.utcnow().strftime('%Y-%m-%d')
    year, month, day = d[:4], d[5:7], d[8:10]
    return f"screenshots/{year}/{month}/{day}/{domain}/{url_hash(url)}.jpg"

def sanitise(s: str) -> str:
    """ASCII-only, printable, max 256 chars for S3 tags/metadata."""
    return ''.join(c for c in str(s) if 32 <= ord(c) < 128)[:256]

def upload_to_s3(s3_client, image_bytes: bytes, key: str, tags: dict) -> bool:
    from urllib.parse import quote
    try:
        # Sanitise all tag values to ASCII printable
        clean = {k: sanitise(v) for k, v in tags.items() if v}
        # URL-encode keys and values for S3 tagging header
        tag_str = '&'.join(
            f"{quote(k, safe='')}={quote(v, safe='')}"
            for k, v in clean.items()
        )
        s3_client.put_object(
            Bucket=ARCHIVE_BUCKET,
            Key=key,
            Body=image_bytes,
            ContentType='image/jpeg',
            Tagging=tag_str,
            Metadata=clean,
        )
        return True
    except Exception as e:
        # S3 object tags have strict value rules; some titles produce invalid
        # tag values (InvalidTag). The metadata is redundant (held in the SQLite
        # index + the S3 manifest), so never let tagging block the capture from
        # being stored — retry without tags.
        print(f"    tagged upload failed ({e}); retrying without tags")
        try:
            s3_client.put_object(
                Bucket=ARCHIVE_BUCKET, Key=key, Body=image_bytes,
                ContentType='image/jpeg',
            )
            return True
        except Exception as e2:
            print(f"    S3 upload failed: {e2}")
            return False

# ── Main run ──────────────────────────────────────────────────────────────────
def cmd_run(args):
    conn = sqlite3.connect(DB_PATH)
    init_db(conn)
    existing = {r[0] for r in conn.execute("SELECT id FROM archive")}

    s3 = boto3.client('s3', region_name=AWS_REGION)
    articles = get_pending_urls()

    if not articles:
        print("No articles found in Redis")
        return

    # Filter already archived
    pending = [a for a in articles if url_hash(a['url']) not in existing]
    print(f"Found {len(articles)} articles, {len(pending)} not yet archived")
    # Refresh the manifest from already-captured rows BEFORE the (slow) capture
    # loop. Scheduled systemd runs can hit TimeoutStartSec and be SIGTERM'd mid-
    # capture before reaching the end-of-run write; writing here ensures the
    # manifest still reflects all prior captures every run, so it never goes
    # stale even if this run is killed.
    write_manifest(conn, s3)

    if not pending:
        print("All articles already archived")
        return

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
        )
        context = browser.new_context(
            viewport={'width': SCREENSHOT_W, 'height': 900},
            user_agent='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            java_script_enabled=True,
        )
        page = context.new_page()

        for i, article in enumerate(pending):
            url   = article.get('url', '')
            title = article.get('title', '')
            domain = article.get('domain', urlparse(url).netloc.replace('www.', ''))
            date  = article.get('publishedAt', '')[:10] if article.get('publishedAt') else ''
            uid   = url_hash(url)

            print(f"  [{i+1}/{len(pending)}] {domain} — {title[:60]}")

            image_bytes, page_text = capture_url(page, url)
            if not image_bytes:
                conn.execute(
                    "INSERT OR IGNORE INTO archive (id,url,domain,title,article_date,captured_at,status) VALUES (?,?,?,?,?,?,?)",
                    (uid, url, domain, title, date, datetime.utcnow().isoformat(), 'failed')
                )
                conn.commit()
                continue

            key = s3_key(url, date)
            tags = {
                'url':          url[:256],
                'domain':       domain,
                'title':        title[:256],
                'source_name':  article.get('source', domain) or domain,
                'article_date': date or '',
                'captured_at':  datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S'),
                'bias_label':   article.get('label') or '',
                'bias_score':   str(article.get('score')) if article.get('score') is not None else '',
                'variant':      'trans',
            }

            ok = upload_to_s3(s3, image_bytes, key, tags)
            status = 'ok' if ok else 'upload_failed'

            # Text capture: store alongside the screenshot, same key with .txt.
            img_sha = hashlib.sha256(image_bytes).hexdigest()
            text_key = None
            text_sha = None
            text_len = 0
            if page_text:
                text_bytes = page_text.encode('utf-8')
                text_sha = hashlib.sha256(text_bytes).hexdigest()
                text_len = len(page_text)
                text_key = key[:-4] + '.txt' if key.endswith('.jpg') else key + '.txt'
                try:
                    s3.put_object(
                        Bucket=ARCHIVE_BUCKET, Key=text_key, Body=text_bytes,
                        ContentType='text/plain; charset=utf-8',
                    )
                except Exception as e:
                    print(f"    text upload failed: {e}")
                    text_key = None

            conn.execute("""
                INSERT OR IGNORE INTO archive
                  (id,url,domain,title,article_date,captured_at,s3_key,
                   bias_label,bias_score,file_size_bytes,status,
                   text_s3_key,image_sha256,text_sha256,text_len)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """, (
                uid, url, domain, title, date,
                datetime.utcnow().isoformat(), key if ok else None,
                article.get('label', ''), article.get('score'),
                len(image_bytes), status,
                text_key, img_sha, text_sha, text_len,
            ))
            conn.commit()
            existing.add(uid)

        page.close()
        context.close()
        browser.close()

    total = conn.execute("SELECT COUNT(*) FROM archive WHERE status='ok'").fetchone()[0]
    failed = conn.execute("SELECT COUNT(*) FROM archive WHERE status='failed' OR status='upload_failed'").fetchone()[0]
    print(f"\n✅ Archive complete — {total} screenshots stored, {failed} failed")
    write_manifest(conn, s3)
    conn.close()

def write_manifest(conn, s3_client):
    """Write a lookup manifest to S3 so the archive-lookup Lambda can map an
    article URL (by its url_hash) to stored snapshot/text keys without reaching
    this box. Only 'ok' rows are included. Keyed by url_hash (matches url_hash()
    used for the S3 object keys)."""
    rows = conn.execute("""
        SELECT id, url, domain, s3_key, text_s3_key, captured_at,
               image_sha256, text_sha256, text_len, file_size_bytes
        FROM archive WHERE status='ok' AND s3_key IS NOT NULL
    """).fetchall()
    manifest = {}
    gn_sizes = []  # capture sizes for GN-resolved URLs, for resolver-health check
    for (uid, url, domain, s3_key, text_key, captured_at,
         img_sha, text_sha, text_len, file_size_bytes) in rows:
        if "news.google.com" in (url or ""):
            gn_sizes.append(file_size_bytes or 0)
        manifest[uid] = {
            "url": url,
            "domain": domain,
            "screenshot_key": s3_key,
            "text_key": text_key,
            "captured_at": captured_at,
            "image_sha256": img_sha,
            "text_sha256": text_sha,
            "text_len": text_len or 0,
        }
    # GN-resolver health check: GN URLs should resolve to real publisher pages
    # (hundreds of KB+). If most GN captures are block-page-sized (~32KB), the
    # batchexecute resolver has likely broken (Google changed the format/cookie)
    # and we're silently capturing consent pages again. Loud warning, no failure.
    BLOCK_PAGE_MAX = 60_000  # bytes; real articles far exceed this, block pages ~32KB
    if gn_sizes:
        small = sum(1 for sz in gn_sizes if sz < BLOCK_PAGE_MAX)
        pct = 100 * small / len(gn_sizes)
        if pct > 50:
            print(f"⚠️  GN-RESOLVER HEALTH: {small}/{len(gn_sizes)} ({pct:.0f}%) of Google "
                  f"News captures are block-page-sized (<{BLOCK_PAGE_MAX//1000}KB). The "
                  f"batchexecute resolver may be BROKEN — check resolve_google_news / consent cookie.")
        else:
            print(f"  GN-resolver health OK: {len(gn_sizes)-small}/{len(gn_sizes)} GN captures are real-sized")

    body = json.dumps({
        "generated_at": datetime.utcnow().isoformat(),
        "count": len(manifest),
        "entries": manifest,
    }).encode("utf-8")
    try:
        s3_client.put_object(
            Bucket=ARCHIVE_BUCKET, Key="index/manifest.json",
            Body=body, ContentType="application/json",
        )
        print(f"  manifest written: {len(manifest)} entries -> index/manifest.json")
    except Exception as e:
        print(f"  manifest write failed: {e}")

def cmd_stats(args):
    if not DB_PATH.exists():
        print("No archive index yet. Run: python3 archiver.py run")
        return
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    total     = conn.execute("SELECT COUNT(*) FROM archive").fetchone()[0]
    ok        = conn.execute("SELECT COUNT(*) FROM archive WHERE status='ok'").fetchone()[0]
    failed    = conn.execute("SELECT COUNT(*) FROM archive WHERE status!='ok'").fetchone()[0]
    by_domain = conn.execute("SELECT domain, COUNT(*) n FROM archive GROUP BY domain ORDER BY n DESC LIMIT 15").fetchall()
    size      = conn.execute("SELECT SUM(file_size_bytes) FROM archive WHERE status='ok'").fetchone()[0] or 0
    print(f"\n📸 TransMonitor Archive Index — {DB_PATH}")
    print(f"  Total:   {total:,} ({ok:,} ok, {failed:,} failed)")
    print(f"  Storage: {size/1024/1024:.1f} MB")
    print(f"\n  By domain:")
    for r in by_domain:
        print(f"    {r['domain']:40} {r['n']:,}")
    conn.close()

def cmd_search(args):
    if not args:
        print("Usage: python3 archiver.py search <query>")
        return
    query = ' '.join(args)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    rows = conn.execute("""
        SELECT * FROM archive
        WHERE title LIKE ? OR domain LIKE ? OR bias_label LIKE ?
        ORDER BY captured_at DESC LIMIT 20
    """, (f'%{query}%', f'%{query}%', f'%{query}%')).fetchall()
    if not rows:
        print(f"No results for '{query}'")
        return
    for r in rows:
        print(f"\n  [{r['article_date']}] {r['domain']} — {r['title'][:70]}")
        print(f"  bias: {r['bias_label']} ({r['bias_score']}) | {r['url'][:80]}")
        if r['s3_key']:
            print(f"  s3://{ARCHIVE_BUCKET}/{r['s3_key']}")
    conn.close()

CMDS = {'run': cmd_run, 'stats': cmd_stats, 'search': cmd_search}

if __name__ == '__main__':
    cmd  = sys.argv[1] if len(sys.argv) > 1 else 'help'
    args = sys.argv[2:]
    if cmd not in CMDS:
        print(__doc__); sys.exit(1)
    CMDS[cmd](args)
