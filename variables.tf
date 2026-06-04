variable "aws_region" {
  type    = string
  default = "eu-west-1"
}

variable "environment" {
  type    = string
  default = "prod"
}

variable "cloudflare_api_token" {
  type      = string
  sensitive = true
}

variable "cloudflare_zone_id" {
  type = string
}

variable "cloudflare_account_id" {
  type        = string
  description = "Cloudflare account ID (required for Worker scripts)"
}

variable "hostname" {
  type        = string
  description = "Full public hostname, e.g. trans-news.com"
}

variable "origin_verify_secret" {
  type        = string
  sensitive   = true
  description = "Shared secret injected by Cloudflare Worker, validated by API GW to block direct invocation"
}

variable "groq_api_key" {
  type      = string
  sensitive = true
  default   = ""
}

variable "openrouter_api_key" {
  type      = string
  sensitive = true
  default   = ""
}
