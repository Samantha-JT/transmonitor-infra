variable "name_prefix" {}
variable "hostname" {}
variable "origin_verify_secret" { sensitive = true }
variable "lambda_invoke_arns" { type = map(string) }
variable "lambda_function_names" { type = map(string) }

data "aws_caller_identity" "current" {}

# ── HTTP API ──────────────────────────────────────────────────────────────────

resource "aws_apigatewayv2_api" "main" {
  name          = "${var.name_prefix}-api"
  protocol_type = "HTTP"

  cors_configuration {
    allow_headers = ["content-type", "x-origin-verify"]
    allow_methods = ["GET", "POST", "OPTIONS"]
    allow_origins = ["https://${var.hostname}"]
    max_age       = 300
  }
}

resource "aws_cloudwatch_log_group" "api_gw" {
  name              = "/aws/apigateway/${var.name_prefix}"
  retention_in_days = 30
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.main.id
  name        = "$default"
  auto_deploy = true

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api_gw.arn
    format = jsonencode({
      requestId        = "$context.requestId"
      routeKey         = "$context.routeKey"
      status           = "$context.status"
      responseLength   = "$context.responseLength"
      integrationError = "$context.integrationErrorMessage"
      ip               = "$context.identity.sourceIp"
      userAgent        = "$context.identity.userAgent"
    })
  }

  default_route_settings {
    throttling_burst_limit   = 200
    throttling_rate_limit    = 100
    detailed_metrics_enabled = true
  }
}

# ── Origin-verify authorizer ──────────────────────────────────────────────────

data "archive_file" "authorizer" {
  type        = "zip"
  output_path = "${path.root}/.terraform/lambda_zips/authorizer.zip"

  source {
    filename = "index.mjs"
    content  = <<-JS
      const SECRET = process.env.ORIGIN_VERIFY_SECRET;
      export const handler = async (event) => {
        const header = (event.headers ?? {})["x-origin-verify"] ?? "";
        const isValid = header.length > 0 && header === SECRET;
        return { isAuthorized: isValid, context: {} };
      };
    JS
  }
}

resource "aws_iam_role" "authorizer" {
  name = "${var.name_prefix}-authorizer-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "authorizer_basic" {
  role       = aws_iam_role.authorizer.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_cloudwatch_log_group" "authorizer" {
  name              = "/aws/lambda/${var.name_prefix}-origin-verify"
  retention_in_days = 30
}

resource "aws_lambda_function" "authorizer" {
  function_name    = "${var.name_prefix}-origin-verify"
  role             = aws_iam_role.authorizer.arn
  handler          = "index.handler"
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  timeout          = 5
  memory_size      = 128
  filename         = data.archive_file.authorizer.output_path
  source_code_hash = data.archive_file.authorizer.output_base64sha256
  environment {
    variables = { ORIGIN_VERIFY_SECRET = var.origin_verify_secret }
  }
  depends_on = [aws_cloudwatch_log_group.authorizer]
}

resource "aws_lambda_permission" "authorizer_invoke" {
  statement_id  = "AllowAPIGWInvokeAuthorizer"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.authorizer.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/authorizers/${aws_apigatewayv2_authorizer.origin_verify.id}"
}

resource "aws_apigatewayv2_authorizer" "origin_verify" {
  api_id                            = aws_apigatewayv2_api.main.id
  name                              = "origin-verify"
  authorizer_type                   = "REQUEST"
  authorizer_uri                    = aws_lambda_function.authorizer.invoke_arn
  authorizer_payload_format_version = "2.0"
  enable_simple_responses           = true
  identity_sources                  = ["$request.header.x-origin-verify"]
  authorizer_result_ttl_in_seconds  = 300
}

# ── Routes ────────────────────────────────────────────────────────────────────

locals {
  routes = {
    # Feed
    "GET /digest/{variant}"        = "feed_digest"
    "GET /digest/{variant}/{any+}" = "feed_digest"

    # News
    "GET /news/v1/list-feed-digest"            = "news_digest"
    "POST /news/v1/summarize-article"          = "news_extra"
    "GET /news/v1/list-temporal-anomalies"     = "news_extra"
    "GET /news/v1/summarize-article-cache"     = "news_extra"
    "GET /news/v1/get-summarize-article-cache" = "news_extra"
    "GET /news/v1/sentiment-stats"             = "sentiment_stats"
    "POST /news/v1/sentiment-stats"            = "sentiment_stats"

    # AI
    "POST /insights" = "ai_insights"

    # Trans rights
    "GET /rights/{country}" = "trans_rights"

    # Trans Murder Monitoring
    "GET /tmm/v1/get-data"          = "tmm_data"
    "GET /media/v1/sources"         = "media_bias"
    "POST /archive/v1/lookup"       = "archive_lookup"
    "GET /snap/{id}"                = "snap_viewer"
    "GET /snap/{id}/image"          = "snap_viewer"
    "GET /media/v1/source/{domain}" = "media_bias"

    # RSS
    "GET /rss-proxy" = "rss_proxy"

    # Health
    "GET /health" = "health"

    # Security scoring (called by Cloudflare security worker)
    "POST /security/score" = "security_score"
  }

  lambda_keys = toset(values(local.routes))
}

resource "aws_apigatewayv2_integration" "lambdas" {
  for_each = local.lambda_keys

  api_id                 = aws_apigatewayv2_api.main.id
  integration_type       = "AWS_PROXY"
  integration_uri        = var.lambda_invoke_arns[each.key]
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "routes" {
  for_each = local.routes

  api_id             = aws_apigatewayv2_api.main.id
  route_key          = each.key
  target             = "integrations/${aws_apigatewayv2_integration.lambdas[each.value].id}"
  authorization_type = "CUSTOM"
  authorizer_id      = aws_apigatewayv2_authorizer.origin_verify.id
}

resource "aws_lambda_permission" "api_gw" {
  for_each = var.lambda_function_names

  statement_id  = "AllowAPIGatewayInvoke-${each.key}"
  action        = "lambda:InvokeFunction"
  function_name = each.value
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}

# ── Outputs ───────────────────────────────────────────────────────────────────

output "invoke_url" { value = aws_apigatewayv2_stage.default.invoke_url }
output "api_id" { value = aws_apigatewayv2_api.main.id }
