variable "name_prefix" {}

variable "origin_verify_secret" {
  sensitive = true
}

variable "groq_api_key" {
  sensitive = true
  default   = ""
}

variable "openrouter_api_key" {
  sensitive = true
  default   = ""
}

locals {
  prefix = "/${var.name_prefix}"
}

resource "aws_ssm_parameter" "origin_verify_secret" {
  name      = "${local.prefix}/origin_verify_secret"
  type      = "SecureString"
  value     = var.origin_verify_secret
  overwrite = true
  lifecycle { ignore_changes = [value] }
}

resource "aws_ssm_parameter" "groq_api_key" {
  count     = var.groq_api_key != "" ? 1 : 0
  name      = "${local.prefix}/groq_api_key"
  type      = "SecureString"
  value     = var.groq_api_key
  overwrite = true
  lifecycle { ignore_changes = [value] }
}

resource "aws_ssm_parameter" "openrouter_api_key" {
  count     = var.openrouter_api_key != "" ? 1 : 0
  name      = "${local.prefix}/openrouter_api_key"
  type      = "SecureString"
  value     = var.openrouter_api_key
  overwrite = true
  lifecycle { ignore_changes = [value] }
}

output "prefix" { value = local.prefix }
