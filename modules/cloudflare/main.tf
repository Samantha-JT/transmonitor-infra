terraform {
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"
    }
  }
}

variable "zone_id"              {}
variable "hostname"             {}
variable "api_gateway_url"      {}
variable "s3_website_endpoint"  {}
variable "origin_verify_secret" { sensitive = true }
variable "account_id"           {}

locals {
  subdomain = split(".", var.hostname)[0]
}

# ── DNS ───────────────────────────────────────────────────────────────────────

resource "cloudflare_record" "site" {
  zone_id = var.zone_id
  name    = local.subdomain
  content = var.s3_website_endpoint
  type    = "CNAME"
  proxied = true
  ttl     = 1
}

# ── Zone settings ─────────────────────────────────────────────────────────────

resource "cloudflare_zone_settings_override" "settings" {
  zone_id = var.zone_id

  settings {
    ssl                      = "full"
    always_use_https         = "on"
    min_tls_version          = "1.2"
    automatic_https_rewrites = "on"
    brotli                   = "on"
    http3                    = "on"
    security_level           = "medium"
  }
}

# ── Worker script ─────────────────────────────────────────────────────────────

resource "cloudflare_workers_script" "api_proxy" {
  account_id = var.account_id
  name       = "${replace(var.hostname, ".", "-")}-api-proxy"

  content = templatefile("${path.module}/api-proxy.js.tpl", {
    api_gateway_url      = var.api_gateway_url
    s3_website_endpoint  = var.s3_website_endpoint
    origin_verify_secret = var.origin_verify_secret
    hostname             = var.hostname
  })

  module = true
}

# ── Worker routes ─────────────────────────────────────────────────────────────

resource "cloudflare_workers_route" "api" {
  zone_id     = var.zone_id
  pattern     = "${var.hostname}/api/*"
  script_name = cloudflare_workers_script.api_proxy.name
}

resource "cloudflare_workers_route" "sw_nocache" {
  zone_id     = var.zone_id
  pattern     = "${var.hostname}/sw.js"
  script_name = cloudflare_workers_script.api_proxy.name
}

resource "cloudflare_workers_route" "index_nocache" {
  zone_id     = var.zone_id
  pattern     = "${var.hostname}/index.html"
  script_name = cloudflare_workers_script.api_proxy.name
}

resource "cloudflare_workers_route" "catchall" {
  zone_id     = var.zone_id
  pattern     = "${var.hostname}/*"
  script_name = cloudflare_workers_script.api_proxy.name
}

# ── WAF rate limiting ─────────────────────────────────────────────────────────
# Period 10s is the minimum on free/pro plans. 60s requires Business+.

resource "cloudflare_ruleset" "rate_limit_api" {
  zone_id     = var.zone_id
  name        = "${var.hostname} API rate limit"
  description = "Rate limit /api/* to 20 req/10s per IP"
  kind        = "zone"
  phase       = "http_ratelimit"

  rules {
    action = "block"
    action_parameters {
      response {
        status_code  = 429
        content_type = "application/json"
        content      = "{\"error\":\"Too many requests\"}"
      }
    }
    ratelimit {
      characteristics     = ["cf.colo.id", "ip.src"]
      period              = 10
      requests_per_period = 20
      mitigation_timeout  = 10
    }
    expression  = "(http.host eq \"${var.hostname}\" and starts_with(http.request.uri.path, \"/api/\"))"
    description = "Rate limit API endpoints"
    enabled     = true
  }
}

# ── Outputs ───────────────────────────────────────────────────────────────────

output "hostname" { value = var.hostname }
