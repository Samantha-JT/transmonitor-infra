# Cloudflare Grafana Dashboard

Prometheus scraper + Grafana dashboard for trans-news.com Cloudflare analytics.

## Components

- `scraper.py` — polls Cloudflare GraphQL API every 60s, exposes metrics on :9101
- `cf-dashboard.json` — Grafana dashboard (20 panels), import via API or UI
- Prometheus on :9090, 30d retention
- Grafana on :3000

## Setup

```bash
cd /opt/cf-scraper
python3 -m venv venv
source venv/bin/activate
pip install prometheus-client requests
# Set CF_TOKEN in scraper.py
sudo systemctl enable --now cf-scraper prometheus grafana-server
```

## Metrics exposed

| Metric | Description |
|--------|-------------|
| cf_requests_total | Requests in last 1h window |
| cf_cached_requests | Cached requests in last 1h |
| cf_threats_total | Threats blocked in last 1h |
| cf_bytes_total | Bytes served in last 1h |
| cf_cached_bytes | Cached bytes in last 1h |
| cf_cache_hit_ratio | Cache hit ratio 0-100 |
| cf_threat_rate | Threat rate as % of requests |
| cf_requests_24h | Total requests last 24h |
| cf_threats_24h | Threats last 24h |
| cf_bytes_24h | Bytes served last 24h |
| cf_unique_visitors_24h | Unique visitors last 24h |
