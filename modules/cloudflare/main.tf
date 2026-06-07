terraform {
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"
    }
  }
}

variable "zone_id" {}
variable "hostname" {}
variable "api_gateway_url" {}
variable "s3_website_endpoint" {}
variable "origin_verify_secret" { sensitive = true }
variable "account_id" {}

locals {
  subdomain = split(".", var.hostname)[0]
}

# ── DNS ───────────────────────────────────────────────────────────────────────

resource "cloudflare_record" "site" {
  zone_id = var.zone_id
  name    = "@"
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

# Routes replaced by security_catchall in security worker section below

# ── WAF rate limiting ─────────────────────────────────────────────────────────
# Period 10s is the minimum on free/pro plans. 60s requires Business+.

resource "cloudflare_ruleset" "rate_limit" {
  zone_id = var.zone_id
  name    = "${var.hostname} API rate limit"
  kind    = "zone"
  phase   = "http_ratelimit"

  rules {
    description = "Rate limit API endpoints"
    expression  = "(http.host eq \"${var.hostname}\" and starts_with(http.request.uri.path, \"/api/\"))"
    action      = "block"
    enabled     = true

    action_parameters {
      response {
        status_code  = 429
        content_type = "application/json"
        content      = jsonencode({ error = "Too many requests" })
      }
    }

    ratelimit {
      characteristics     = ["ip.src", "cf.colo.id"]
      period              = 10
      requests_per_period = 20
      mitigation_timeout  = 10
    }
  }
}

# ── Outputs ───────────────────────────────────────────────────────────────────

output "hostname" { value = var.hostname }
# ── Security Worker ───────────────────────────────────────────────────────────
# Add this to modules/cloudflare/main.tf
#
# Required additional variables in the module:
#   anthropic_api_key   (sensitive)
#   slack_webhook_url   (sensitive)
#   cf_api_token        (sensitive)
#
# Required new Terraform resources:

resource "cloudflare_workers_kv_namespace" "security" {
  account_id = var.account_id
  title      = "${var.hostname}-security"
}

resource "cloudflare_workers_script" "security" {
  account_id = var.account_id
  name       = "${replace(var.hostname, ".", "-")}-security"
  content    = file("${path.module}/security-worker.js")
  module     = true

  kv_namespace_binding {
    name         = "SECURITY_KV"
    namespace_id = cloudflare_workers_kv_namespace.security.id
  }

  service_binding {
    name    = "API_PROXY"
    service = cloudflare_workers_script.api_proxy.name
  }

  plain_text_binding {
    name = "CF_ZONE_ID"
    text = var.zone_id
  }

  plain_text_binding {
    name = "HOSTNAME"
    text = var.hostname
  }

  plain_text_binding {
    name = "SCORE_ENDPOINT"
    text = "https://8soi33z3h9.execute-api.eu-west-1.amazonaws.com/security/score"
  }

  secret_text_binding {
    name = "ORIGIN_VERIFY_SECRET"
    text = var.origin_verify_secret
  }

  secret_text_binding {
    name = "CF_API_TOKEN"
    text = var.cf_api_token
  }

}

# Route: security worker runs FIRST on all traffic (higher priority = lower number)
# Your existing api-proxy routes use default priority, so this takes precedence
resource "cloudflare_workers_route" "security_catchall" {
  zone_id     = var.zone_id
  pattern     = "${var.hostname}/*"
  script_name = cloudflare_workers_script.security.name
}

# ── New variables to add to variables section ─────────────────────────────────

variable "cf_api_token"      { sensitive = true }
