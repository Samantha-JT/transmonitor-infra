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
variable "account_id" {}


locals {
  subdomain = split(".", var.hostname)[0]
}

resource "cloudflare_record" "site" {
  zone_id = var.zone_id
  name    = local.subdomain
  content = var.s3_website_endpoint
  type    = "CNAME"
  proxied = true
  ttl     = 1
}

resource "cloudflare_zone_settings_override" "settings" {
  zone_id = var.zone_id

  settings {
    ssl                      = "flexible"
    always_use_https         = "on"
    min_tls_version          = "1.2"
    automatic_https_rewrites = "on"
    brotli                   = "on"
    http3                    = "on"
    security_level           = "medium"
  }
}

output "hostname" { value = var.hostname }

# ── Worker: proxy /api/* to API Gateway ───────────────────────────────────────

resource "cloudflare_workers_script" "api_proxy" {
  account_id = var.account_id
  name = "${replace(var.hostname, ".", "-")}-api-proxy"

  content = templatefile("${path.module}/api-proxy.js.tpl", {
    api_gateway_url      = var.api_gateway_url
    origin_verify_secret = var.origin_verify_secret
  })

  module = true
}

resource "cloudflare_workers_route" "api_proxy" {
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
