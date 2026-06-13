import os
import time
import logging
import requests
from prometheus_client import Histogram, Counter
from datetime import datetime, timezone, timedelta
from prometheus_client import start_http_server, Gauge, Counter

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
log = logging.getLogger(__name__)

CF_TOKEN  = os.environ.get("CF_TOKEN", "")
ZONE_ID   = "fb1dd68091c0bf026b4ff547fb38eb8e"
GRAPHQL   = "https://api.cloudflare.com/client/v4/graphql"
SCRAPE_INTERVAL = 60

requests_total  = Gauge("cf_requests_total",      "Total requests in last hour")
cached_total    = Gauge("cf_cached_requests",     "Cached requests in last hour")
threats_total   = Gauge("cf_threats_total",       "Threats blocked in last hour")
bytes_total     = Gauge("cf_bytes_total",         "Bytes served in last hour")
cached_bytes    = Gauge("cf_cached_bytes",        "Cached bytes in last hour")
pageviews_total = Gauge("cf_pageviews_total",     "Pageviews in last hour")
uniques_total   = Gauge("cf_unique_visitors",     "Unique visitors in last hour")
cache_hit_ratio = Gauge("cf_cache_hit_ratio",     "Cache hit ratio 0-100")
threat_rate     = Gauge("cf_threat_rate",         "Threat rate as pct of requests")
scrape_errors   = Counter("cf_scrape_errors",     "Number of scrape errors")
requests_24h    = Gauge("cf_requests_24h",        "Total requests last 24h")
threats_24h     = Gauge("cf_threats_24h",         "Threats last 24h")
bytes_24h       = Gauge("cf_bytes_24h",           "Bytes served last 24h")
uniques_24h     = Gauge("cf_unique_visitors_24h", "Unique visitors last 24h")

def gql(query):
    resp = requests.post(
        GRAPHQL,
        json={"query": query},
        headers={"Authorization": f"Bearer {CF_TOKEN}"},
        timeout=15
    )
    resp.raise_for_status()
    data = resp.json()
    if data.get("errors"):
        raise ValueError(f"GraphQL errors: {data['errors']}")
    return data

def scrape():
    now          = datetime.now(timezone.utc)
    one_hour_ago = now - timedelta(hours=1)
    one_day_ago  = now - timedelta(hours=24)
    fmt = "%Y-%m-%dT%H:%M:%SZ"

    try:
        # 1h window — no orderBy on this dataset
        q1h = """{ viewer { zones(filter: {zoneTag: "%s"}) {
          httpRequests1hGroups(limit: 1, filter: {datetime_geq: "%s", datetime_leq: "%s"}) {
            sum { requests cachedRequests threats bytes cachedBytes pageViews }
            uniq { uniques }
          } } } }""" % (ZONE_ID, one_hour_ago.strftime(fmt), now.strftime(fmt))

        data   = gql(q1h)
        groups = data["data"]["viewer"]["zones"][0]["httpRequests1hGroups"]

        if groups:
            s    = groups[0]["sum"]
            u    = groups[0]["uniq"]
            reqs = s["requests"]
            cach = s["cachedRequests"]
            requests_total.set(reqs)
            cached_total.set(cach)
            threats_total.set(s["threats"])
            bytes_total.set(s["bytes"])
            cached_bytes.set(s["cachedBytes"])
            pageviews_total.set(s["pageViews"])
            uniques_total.set(u["uniques"])
            cache_hit_ratio.set(round(cach / reqs * 100, 2) if reqs > 0 else 0)
            threat_rate.set(round(s["threats"] / reqs * 100, 2) if reqs > 0 else 0)
            log.info(f"1h: reqs={reqs} cached={cach} threats={s['threats']}")

        # 24h rollup
        q24h = """{ viewer { zones(filter: {zoneTag: "%s"}) {
          httpRequests1hGroups(limit: 24, filter: {datetime_geq: "%s", datetime_leq: "%s"}) {
            sum { requests threats bytes }
            uniq { uniques }
          } } } }""" % (ZONE_ID, one_day_ago.strftime(fmt), now.strftime(fmt))

        data   = gql(q24h)
        groups = data["data"]["viewer"]["zones"][0]["httpRequests1hGroups"]

        r = t = b = u = 0
        for g in groups:
            r += g["sum"]["requests"]
            t += g["sum"]["threats"]
            b += g["sum"]["bytes"]
            u += g["uniq"]["uniques"]

        requests_24h.set(r)
        threats_24h.set(t)
        bytes_24h.set(b)
        uniques_24h.set(u)
        log.info(f"24h: reqs={r} threats={t} bytes={b}")

    except Exception as e:
        scrape_errors.inc()
        log.error(f"Scrape failed: {e}")


PAGE_LOAD_MS = Histogram(
    "transmonitor_page_load_ms",
    "Synthetic page load time in milliseconds",
    ["path"],
    buckets=(100, 250, 500, 750, 1000, 1500, 2000, 3000, 5000, 10000),
)

TTFB_MS = Histogram(
    "transmonitor_ttfb_ms",
    "Synthetic time to first byte in milliseconds",
    ["path"],
    buckets=(50, 100, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000),
)

PAGE_LOAD_COUNT = Counter(
    "transmonitor_page_load_count",
    "Synthetic page load probe count",
    ["path", "status"],
)

PAGE_LOAD_SLOW_TOTAL = Counter(
    "transmonitor_page_load_slow_total",
    "Synthetic page load probes slower than 3000ms",
    ["path"],
)

def probe_page_load():
    url = os.environ.get("PAGE_LOAD_URL", "https://trans-news.com/")
    path = "/"

    try:
        start = time.perf_counter()
        response = requests.get(url, timeout=10, stream=True)

        # TTFB approximation: time until headers are available.
        ttfb_ms = (time.perf_counter() - start) * 1000

        # Consume body so this is closer to full document load, not just headers.
        _ = response.content
        total_ms = (time.perf_counter() - start) * 1000

        PAGE_LOAD_MS.labels(path=path).observe(total_ms)
        TTFB_MS.labels(path=path).observe(ttfb_ms)
        PAGE_LOAD_COUNT.labels(path=path, status=str(response.status_code)).inc()

        if total_ms > 3000:
            PAGE_LOAD_SLOW_TOTAL.labels(path=path).inc()

        log.info(
            "Page load probe: url=%s status=%s ttfb_ms=%.1f total_ms=%.1f",
            url,
            response.status_code,
            ttfb_ms,
            total_ms,
        )
    except Exception:
        PAGE_LOAD_COUNT.labels(path=path, status="error").inc()
        log.exception("Page load probe failed")

if __name__ == "__main__":
    log.info("Starting CF scraper on :9101")
    start_http_server(9101)
    while True:
        scrape()
        probe_page_load()
        time.sleep(SCRAPE_INTERVAL)
