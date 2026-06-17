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
NAVIGATE_TIMEOUT= 25_000   # ms

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
def dismiss_cookies(page):
    for selector in COOKIE_SELECTORS:
        try:
            el = page.locator(selector).first
            if el.is_visible(timeout=1000):
                el.click(timeout=2000)
                page.wait_for_timeout(500)
                break
        except Exception:
            continue

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

def capture_url(page, url: str):
    """Returns (image_bytes, text) for the page, or (None, None) on failure.
    Text is captured in the same page visit as the screenshot so both come from
    the identical render. Text is always full, even when the screenshot is clipped."""
    try:
        page.goto(url, wait_until='domcontentloaded', timeout=NAVIGATE_TIMEOUT)
        page.wait_for_timeout(2000)  # let JS render
        dismiss_cookies(page)
        page.wait_for_timeout(1000)

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
        print(f"    S3 upload failed: {e}")
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
    conn.close()

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
