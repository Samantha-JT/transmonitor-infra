variable "name_prefix" {}

variable "groq_api_key" {
  sensitive = true
  default   = ""
}

variable "openrouter_api_key" {
  sensitive = true
  default   = ""
}

variable "acled_email" {
  default = ""
}

variable "acled_password" {
  sensitive = true
  default   = ""
}

variable "finnhub_api_key" {
  sensitive = true
  default   = ""
}

variable "fred_api_key" {
  sensitive = true
  default   = ""
}

variable "nasa_firms_api_key" {
  sensitive = true
  default   = ""
}

variable "origin_verify_secret" {
  sensitive = true
}

locals {
  prefix = "/${var.name_prefix}"
}

# origin_verify_secret is always required
resource "aws_ssm_parameter" "origin_verify_secret" {
  name  = "${local.prefix}/origin_verify_secret"
  type  = "SecureString"
  value = var.origin_verify_secret
  overwrite = true
  lifecycle { ignore_changes = [value] }
}

# Optional — only created when non-empty
resource "aws_ssm_parameter" "groq_api_key" {
  count = var.groq_api_key != "" ? 1 : 0
  name  = "${local.prefix}/groq_api_key"
  type  = "SecureString"
  value = var.groq_api_key
  overwrite = true
  lifecycle { ignore_changes = [value] }
}

resource "aws_ssm_parameter" "openrouter_api_key" {
  count = var.openrouter_api_key != "" ? 1 : 0
  name  = "${local.prefix}/openrouter_api_key"
  type  = "SecureString"
  value = var.openrouter_api_key
  overwrite = true
  lifecycle { ignore_changes = [value] }
}

resource "aws_ssm_parameter" "acled_email" {
  count = var.acled_email != "" ? 1 : 0
  name  = "${local.prefix}/acled_email"
  type  = "String"
  value = var.acled_email
  overwrite = true
  lifecycle { ignore_changes = [value] }
}

resource "aws_ssm_parameter" "acled_password" {
  count = var.acled_password != "" ? 1 : 0
  name  = "${local.prefix}/acled_password"
  type  = "SecureString"
  value = var.acled_password
  overwrite = true
  lifecycle { ignore_changes = [value] }
}

resource "aws_ssm_parameter" "finnhub_api_key" {
  count = var.finnhub_api_key != "" ? 1 : 0
  name  = "${local.prefix}/finnhub_api_key"
  type  = "SecureString"
  value = var.finnhub_api_key
  overwrite = true
  lifecycle { ignore_changes = [value] }
}

resource "aws_ssm_parameter" "fred_api_key" {
  count = var.fred_api_key != "" ? 1 : 0
  name  = "${local.prefix}/fred_api_key"
  type  = "SecureString"
  value = var.fred_api_key
  overwrite = true
  lifecycle { ignore_changes = [value] }
}

resource "aws_ssm_parameter" "nasa_firms_api_key" {
  count = var.nasa_firms_api_key != "" ? 1 : 0
  name  = "${local.prefix}/nasa_firms_api_key"
  type  = "SecureString"
  value = var.nasa_firms_api_key
  overwrite = true
  lifecycle { ignore_changes = [value] }
}

output "prefix" { value = local.prefix }
