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

variable "hostname" {
  type        = string
  description = "Full public hostname, e.g. trans.example.com"
}

variable "origin_verify_secret" {
  type        = string
  sensitive   = true
  description = "Shared secret added by Cloudflare, validated by API GW to block direct invocation"
}

# API keys stored in SSM
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

variable "acled_email" {
  type    = string
  default = ""
}

variable "acled_password" {
  type      = string
  sensitive = true
  default   = ""
}

variable "finnhub_api_key" {
  type      = string
  sensitive = true
  default   = ""
}

variable "fred_api_key" {
  type      = string
  sensitive = true
  default   = ""
}

variable "nasa_firms_api_key" {
  type      = string
  sensitive = true
  default   = ""
}

variable "cloudflare_account_id" {
  description = "Cloudflare account ID (required for Worker scripts)"
}
variable "upstash_redis_rest_url" {
  default = ""
}

variable "upstash_redis_rest_token" {
  sensitive = true
  default   = ""
}