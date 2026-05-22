variable "name_prefix"           {}
variable "hostname"              {}
variable "origin_verify_secret"  { sensitive = true }
variable "lambda_invoke_arns"    { type = map(string) }
variable "lambda_function_names" { type = map(string) }

resource "aws_apigatewayv2_api" "main" {
  name          = "${var.name_prefix}-api"
  protocol_type = "HTTP"

  cors_configuration {
    allow_headers  = ["content-type", "x-origin-verify"]
    allow_methods  = ["GET", "POST", "OPTIONS"]
    allow_origins  = ["https://${var.hostname}"]
    max_age        = 300
  }
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
    })
  }

  default_route_settings {
    throttling_burst_limit = 100
    throttling_rate_limit  = 50
  }
}

resource "aws_cloudwatch_log_group" "api_gw" {
  name              = "/aws/apigateway/${var.name_prefix}"
  retention_in_days = 30
}

# ── Integrations ──────────────────────────────────────────────────────────────

locals {
  routes = {
    "GET /digest/{variant}"       = "feed_digest"
    "GET /digest/{variant}/{any+}" = "feed_digest"
    "POST /insights"              = "ai_insights"
    "GET /rights/{country}"       = "trans_rights"
    "GET /video/{channelId}"      = "youtube_proxy"
    "GET /health"                  = "health"
    "GET /rss-proxy"               = "rss_proxy"
    "GET /youtube/live"            = "youtube_live"
    "GET /youtube/latest"          = "youtube_latest"
    "GET /news/v1/list-feed-digest" = "news_digest"
    "GET /news/v1/sentiment-stats"     = "sentiment_stats"
    "POST /news/v1/sentiment-stats"    = "sentiment_stats"
    "GET /tmm/v1/get-data"             = "tmm_data"
    "GET /market/v1/list-market-quotes" = "market"
    "GET /market/v1/list-crypto-quotes" = "market"
    "GET /market/v1/list-crypto-sectors" = "market"
    "GET /market/v1/list-defi-tokens" = "market"
    "GET /market/v1/list-ai-tokens" = "market"
    "GET /market/v1/list-other-tokens" = "market"
    "GET /market/v1/get-fear-greed-index" = "market"
    "GET /market/v1/list-stablecoin-markets" = "market"
    "GET /market/v1/list-etf-flows" = "market"
    "GET /market/v1/list-gulf-quotes" = "market"
    "GET /market/v1/get-gold-intelligence" = "market"
    "GET /market/v1/list-earnings-calendar" = "market"
    "GET /market/v1/get-cot-positioning" = "market"
    "GET /market/v1/get-market-breadth-history" = "market"
    "GET /market/v1/list-commodity-quotes" = "market"
    "GET /economic/v1/get-macro-signals" = "economic"
    "POST /economic/v1/get-fred-series-batch" = "economic"
    "GET /economic/v1/list-bigmac-prices" = "economic"
    "GET /economic/v1/list-fuel-prices" = "economic"
    "GET /economic/v1/list-grocery-basket-prices" = "economic"
    "GET /economic/v1/get-economic-calendar" = "economic"
    "GET /economic/v1/get-eurostat-country-data" = "economic"
    "GET /economic/v1/get-energy-crisis-policies" = "economic"
    "GET /economic/v1/get-eu-yield-curve" = "economic"
    "GET /economic/v1/get-fao-food-price-index" = "economic"
    "GET /economic/v1/get-crude-inventories" = "economic"
    "GET /economic/v1/get-nat-gas-storage" = "economic"
    "GET /economic/v1/get-ecb-fx-rates" = "economic"
    "GET /economic/v1/get-eu-gas-storage" = "economic"
    "GET /economic/v1/get-national-debt" = "economic"
    "GET /economic/v1/get-bis-policy-rates" = "economic"
    "GET /economic/v1/get-bis-exchange-rates" = "economic"
    "GET /economic/v1/get-bis-credit" = "economic"
    "GET /economic/v1/get-economic-stress" = "economic"
    "POST /news/v1/summarize-article" = "news_extra"
    "GET /news/v1/list-temporal-anomalies" = "news_extra"
    "GET /research/v1/list-tech-events" = "research"
    "GET /research/v1/list-defense-patents" = "research"
    "GET /climate/v1/list-climate-news" = "climate"
    "GET /climate/v1/list-climate-anomalies" = "climate"
    "GET /climate/v1/list-climate-disasters" = "climate"
    "GET /climate/v1/get-co2-monitoring" = "climate"
    "GET /climate/v1/get-ocean-ice-data" = "climate"
    "GET /climate/v1/list-air-quality-data" = "climate"
    "GET /supply-chain/hormuz-tracker" = "supply_chain"
    "GET /supply-chain/v1/get-chokepoint-status" = "supply_chain"
    "GET /supply-chain/v1/get-shipping-rates" = "supply_chain"
    "GET /supply-chain/v1/get-critical-minerals" = "supply_chain"
    "GET /supply-chain/v1/get-shipping-stress" = "supply_chain"
    "GET /supply-chain/v1/get-country-chokepoint-index" = "supply_chain"
    "GET /supply-chain/v1/get-country-cost-shock" = "supply_chain"
    "GET /infrastructure/v1/list-temporal-anomalies" = "infrastructure"
    "GET /infrastructure/v1/list-internet-outages" = "infrastructure"
    "GET /infrastructure/v1/list-service-statuses" = "infrastructure"
    "GET /infrastructure/v1/get-cable-health" = "infrastructure"
    "GET /infrastructure/v1/list-ddos-attacks" = "infrastructure"
    "GET /infrastructure/v1/list-traffic-anomalies" = "infrastructure"
    "GET /infrastructure/v1/get-bootstrap-data" = "infrastructure"
    "GET /news/v1/summarize-article-cache" = "news_extra"
    "GET /news/v1/get-summarize-article-cache" = "news_extra"
    "GET /market/v1/get-sector-summary" = "market"
    "GET /military/v1/list-defense-patents" = "research"
    "GET /bootstrap" = "infrastructure"
  }
}

resource "aws_apigatewayv2_integration" "lambdas" {
  for_each = toset(values(local.routes))

  api_id                 = aws_apigatewayv2_api.main.id
  integration_type       = "AWS_PROXY"
  integration_uri        = var.lambda_invoke_arns[each.key]
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "routes" {
  for_each = local.routes

  api_id    = aws_apigatewayv2_api.main.id
  route_key = each.key
  target    = "integrations/${aws_apigatewayv2_integration.lambdas[each.value].id}"
}

# Lambda permissions for APIGW
resource "aws_lambda_permission" "api_gw" {
  for_each = var.lambda_function_names

  statement_id  = "AllowAPIGatewayInvoke-${each.key}"
  action        = "lambda:InvokeFunction"
  function_name = each.value
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}

output "invoke_url" { value = aws_apigatewayv2_stage.default.invoke_url }
output "api_id"     { value = aws_apigatewayv2_api.main.id }
