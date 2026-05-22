variable "name_prefix"          {}
variable "aws_region"           {}
variable "vpc_id"               {}
variable "private_subnet_ids"   { type = list(string) }
variable "lambda_sg_id"         {}
variable "redis_endpoint"       {}
variable "digest_bucket_name"   {}
variable "ssm_prefix"           {}
variable "origin_verify_secret" { sensitive = true }

data "aws_caller_identity" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id

  common_env = {
    REDIS_URL          = "rediss://${var.redis_endpoint}:6380"
    DIGEST_BUCKET      = var.digest_bucket_name
    SSM_PREFIX         = var.ssm_prefix
    NODE_ENV                = "production"
    VARIANT                 = "trans"
    AWS_BEDROCK_REGION      = "eu-west-1"
    AWS_BEDROCK_MODEL_ID    = "eu.anthropic.claude-haiku-4-5-20251001-v1:0"
  }

  # VPC config for functions that need Redis
  vpc_config = {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_sg_id]
  }
}

# ── IAM ───────────────────────────────────────────────────────────────────────

resource "aws_iam_role" "lambda" {
  name = "${var.name_prefix}-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "vpc_access" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

resource "aws_iam_role_policy_attachment" "basic_execution" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "lambda_permissions" {
  name = "${var.name_prefix}-lambda-policy"
  role = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:ListBucket"]
        Resource = [
          "arn:aws:s3:::${var.digest_bucket_name}",
          "arn:aws:s3:::${var.digest_bucket_name}/*"
        ]
      },
      {
        Effect   = "Allow"
        Action   = ["ssm:GetParameter", "ssm:GetParametersByPath"]
        Resource = "arn:aws:ssm:${var.aws_region}:${local.account_id}:parameter${var.ssm_prefix}/*"
      },
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:*:*:*"
      },
      {
        Effect   = "Allow"
        Action   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
        Resource = "*"
      },
      {
        Effect   = "Allow"
        Action   = ["bedrock:InvokeModel"]
        Resource = "*"
      }
    ]
  })
}

# ── Lambda zip sources ─────────────────────────────────────────────────────────
# In practice these zips are built by CI (npm run build && zip).
# For bootstrapping we include a stub handler so terraform apply doesn't fail.

data "archive_file" "feed_digest" {
  type        = "zip"
  source_dir  = "${path.root}/lambda_src/feed-digest/dist"
  output_path = "${path.root}/.terraform/lambda_zips/feed-digest.zip"
}

data "archive_file" "ai_insights" {
  type        = "zip"
  source_dir  = "${path.root}/lambda_src/ai-insights/dist"
  output_path = "${path.root}/.terraform/lambda_zips/ai-insights.zip"
}

data "archive_file" "trans_rights" {
  type        = "zip"
  source_dir  = "${path.root}/lambda_src/trans-rights/dist"
  output_path = "${path.root}/.terraform/lambda_zips/trans-rights.zip"
}

data "archive_file" "youtube_proxy" {
  type        = "zip"
  source_dir  = "${path.root}/lambda_src/youtube-proxy/dist"
  output_path = "${path.root}/.terraform/lambda_zips/youtube-proxy.zip"
}

data "archive_file" "feed_ingestor" {
  type        = "zip"
  source_dir  = "${path.root}/lambda_src/feed-ingestor/dist"
  output_path = "${path.root}/.terraform/lambda_zips/feed-ingestor.zip"
}

data "archive_file" "health" {
  type        = "zip"
  source_dir  = "${path.root}/lambda_src/health/dist"
  output_path = "${path.root}/.terraform/lambda_zips/health.zip"
}

# ── Functions ─────────────────────────────────────────────────────────────────

resource "aws_lambda_function" "feed_digest" {
  function_name    = "${var.name_prefix}-feed-digest"
  role             = aws_iam_role.lambda.arn
  handler          = "index.handler"
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  timeout          = 15
  memory_size      = 256
  filename         = data.archive_file.feed_digest.output_path
  source_code_hash = data.archive_file.feed_digest.output_base64sha256

  environment { variables = local.common_env }

  vpc_config {
    subnet_ids         = local.vpc_config.subnet_ids
    security_group_ids = local.vpc_config.security_group_ids
  }

  tracing_config { mode = "Active" }
}

resource "aws_lambda_function" "ai_insights" {
  function_name    = "${var.name_prefix}-ai-insights"
  role             = aws_iam_role.lambda.arn
  handler          = "index.handler"
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  timeout          = 30
  memory_size      = 512
  filename         = data.archive_file.ai_insights.output_path
  source_code_hash = data.archive_file.ai_insights.output_base64sha256

  environment { variables = local.common_env }

  vpc_config {
    subnet_ids         = local.vpc_config.subnet_ids
    security_group_ids = local.vpc_config.security_group_ids
  }

  tracing_config { mode = "Active" }
}

resource "aws_lambda_function" "trans_rights" {
  function_name    = "${var.name_prefix}-trans-rights"
  role             = aws_iam_role.lambda.arn
  handler          = "index.handler"
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  timeout          = 10
  memory_size      = 128
  filename         = data.archive_file.trans_rights.output_path
  source_code_hash = data.archive_file.trans_rights.output_base64sha256

  environment { variables = local.common_env }
  tracing_config { mode = "Active" }
}

resource "aws_lambda_function" "youtube_proxy" {
  function_name    = "${var.name_prefix}-youtube-proxy"
  role             = aws_iam_role.lambda.arn
  handler          = "index.handler"
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  timeout          = 15
  memory_size      = 128
  filename         = data.archive_file.youtube_proxy.output_path
  source_code_hash = data.archive_file.youtube_proxy.output_base64sha256

  environment { variables = local.common_env }
  tracing_config { mode = "Active" }
}

resource "aws_lambda_function" "feed_ingestor" {
  function_name    = "${var.name_prefix}-feed-ingestor"
  role             = aws_iam_role.lambda.arn
  handler          = "index.handler"
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  timeout          = 300
  memory_size      = 512
  filename         = data.archive_file.feed_ingestor.output_path
  source_code_hash = data.archive_file.feed_ingestor.output_base64sha256

  environment { variables = local.common_env }

  vpc_config {
    subnet_ids         = local.vpc_config.subnet_ids
    security_group_ids = local.vpc_config.security_group_ids
  }

  tracing_config { mode = "Active" }
}

resource "aws_lambda_function" "health" {
  function_name    = "${var.name_prefix}-health"
  role             = aws_iam_role.lambda.arn
  handler          = "index.handler"
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  timeout          = 5
  memory_size      = 128
  filename         = data.archive_file.health.output_path
  source_code_hash = data.archive_file.health.output_base64sha256

  environment { variables = local.common_env }
  tracing_config { mode = "Active" }
}

# CloudWatch log groups with 30-day retention
resource "aws_cloudwatch_log_group" "lambdas" {
  for_each = toset([
    "/aws/lambda/${aws_lambda_function.feed_digest.function_name}",
    "/aws/lambda/${aws_lambda_function.ai_insights.function_name}",
    "/aws/lambda/${aws_lambda_function.trans_rights.function_name}",
    "/aws/lambda/${aws_lambda_function.youtube_proxy.function_name}",
    "/aws/lambda/${aws_lambda_function.feed_ingestor.function_name}",
    "/aws/lambda/${aws_lambda_function.health.function_name}",
  ])

  name              = each.key
  retention_in_days = 30
}

# ── Outputs ───────────────────────────────────────────────────────────────────

output "invoke_arns" {
  value = {
    feed_digest   = aws_lambda_function.feed_digest.invoke_arn
    ai_insights   = aws_lambda_function.ai_insights.invoke_arn
    trans_rights  = aws_lambda_function.trans_rights.invoke_arn
    youtube_proxy = aws_lambda_function.youtube_proxy.invoke_arn
    health         = aws_lambda_function.health.invoke_arn
    rss_proxy      = aws_lambda_function.rss_proxy.invoke_arn
    youtube_live   = aws_lambda_function.youtube_live.invoke_arn
    youtube_latest = aws_lambda_function.youtube_latest.invoke_arn
    news_digest      = aws_lambda_function.news_digest.invoke_arn
    sentiment_stats  = aws_lambda_function.sentiment_stats.invoke_arn
    tmm_data         = aws_lambda_function.tmm_data.invoke_arn
  
    market = aws_lambda_function.market.invoke_arn

    economic = aws_lambda_function.economic.invoke_arn

    news_extra = aws_lambda_function.news_extra.invoke_arn

    research = aws_lambda_function.research.invoke_arn

    climate = aws_lambda_function.climate.invoke_arn

    supply_chain = aws_lambda_function.supply_chain.invoke_arn
    infrastructure = aws_lambda_function.infrastructure.invoke_arn
}
}

output "function_names" {
  value = {
    feed_digest   = aws_lambda_function.feed_digest.function_name
    ai_insights   = aws_lambda_function.ai_insights.function_name
    trans_rights  = aws_lambda_function.trans_rights.function_name
    youtube_proxy = aws_lambda_function.youtube_proxy.function_name
    health         = aws_lambda_function.health.function_name
    rss_proxy      = aws_lambda_function.rss_proxy.function_name
    youtube_live   = aws_lambda_function.youtube_live.function_name
    youtube_latest = aws_lambda_function.youtube_latest.function_name
    news_digest    = aws_lambda_function.news_digest.function_name
  
    market = aws_lambda_function.market.function_name

    economic = aws_lambda_function.economic.function_name

    news_extra = aws_lambda_function.news_extra.function_name

    research = aws_lambda_function.research.function_name

    climate = aws_lambda_function.climate.function_name

    supply_chain = aws_lambda_function.supply_chain.function_name
    infrastructure = aws_lambda_function.infrastructure.function_name
}
}

output "feed_ingestor_arn"  { value = aws_lambda_function.feed_ingestor.arn }
output "feed_ingestor_name" { value = aws_lambda_function.feed_ingestor.function_name }

data "archive_file" "rss_proxy" {
  type        = "zip"
  source_dir  = "${path.root}/lambda_src/rss-proxy/dist"
  output_path = "${path.root}/.terraform/lambda_zips/rss-proxy.zip"
}

data "archive_file" "youtube_live" {
  type        = "zip"
  source_dir  = "${path.root}/lambda_src/youtube-live/dist"
  output_path = "${path.root}/.terraform/lambda_zips/youtube-live.zip"
}

data "archive_file" "youtube_latest" {
  type        = "zip"
  source_dir  = "${path.root}/lambda_src/youtube-latest/dist"
  output_path = "${path.root}/.terraform/lambda_zips/youtube-latest.zip"
}

resource "aws_lambda_function" "rss_proxy" {
  function_name    = "${var.name_prefix}-rss-proxy"
  role             = aws_iam_role.lambda.arn
  handler          = "index.handler"
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  timeout          = 25
  memory_size      = 128
  filename         = data.archive_file.rss_proxy.output_path
  source_code_hash = data.archive_file.rss_proxy.output_base64sha256
  environment { variables = local.common_env }
  tracing_config { mode = "Active" }
}

resource "aws_lambda_function" "youtube_live" {
  function_name    = "${var.name_prefix}-youtube-live"
  role             = aws_iam_role.lambda.arn
  handler          = "index.handler"
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  timeout          = 15
  memory_size      = 128
  filename         = data.archive_file.youtube_live.output_path
  source_code_hash = data.archive_file.youtube_live.output_base64sha256
  environment { variables = local.common_env }
  tracing_config { mode = "Active" }
}

resource "aws_lambda_function" "youtube_latest" {
  function_name    = "${var.name_prefix}-youtube-latest"
  role             = aws_iam_role.lambda.arn
  handler          = "index.handler"
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  timeout          = 15
  memory_size      = 128
  filename         = data.archive_file.youtube_latest.output_path
  source_code_hash = data.archive_file.youtube_latest.output_base64sha256
  environment { variables = local.common_env }
  tracing_config { mode = "Active" }
}

data "archive_file" "news_digest" {
  type        = "zip"
  source_dir  = "${path.root}/lambda_src/news-digest/dist"
  output_path = "${path.root}/.terraform/lambda_zips/news-digest.zip"
}

resource "aws_lambda_function" "news_digest" {
  function_name    = "${var.name_prefix}-news-digest"
  role             = aws_iam_role.lambda.arn
  handler          = "index.handler"
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  timeout          = 30
  memory_size      = 512
  filename         = data.archive_file.news_digest.output_path
  source_code_hash = data.archive_file.news_digest.output_base64sha256

  environment { variables = local.common_env }

  vpc_config {
    subnet_ids         = local.vpc_config.subnet_ids
    security_group_ids = local.vpc_config.security_group_ids
  }

  tracing_config { mode = "Active" }
}

data "archive_file" "sentiment_stats" {
  type        = "zip"
  source_dir  = "${path.root}/lambda_src/sentiment-stats/dist"
  output_path = "${path.root}/.terraform/lambda_zips/sentiment-stats.zip"
}

resource "aws_lambda_function" "sentiment_stats" {
  function_name    = "${var.name_prefix}-sentiment-stats"
  role             = aws_iam_role.lambda.arn
  handler          = "index.handler"
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  timeout          = 15
  memory_size      = 256
  filename         = data.archive_file.sentiment_stats.output_path
  source_code_hash = data.archive_file.sentiment_stats.output_base64sha256
  environment { variables = local.common_env }
  vpc_config {
    subnet_ids         = local.vpc_config.subnet_ids
    security_group_ids = local.vpc_config.security_group_ids
  }
  tracing_config { mode = "Active" }
}

data "archive_file" "tmm_data" {
  type        = "zip"
  source_dir  = "${path.root}/lambda_src/tmm-data/dist"
  output_path = "${path.root}/.terraform/lambda_zips/tmm-data.zip"
}

resource "aws_lambda_function" "tmm_data" {
  function_name    = "${var.name_prefix}-tmm-data"
  role             = aws_iam_role.lambda.arn
  handler          = "index.handler"
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  timeout          = 5
  memory_size      = 128
  filename         = data.archive_file.tmm_data.output_path
  source_code_hash = data.archive_file.tmm_data.output_base64sha256
  environment { variables = local.common_env }
  tracing_config { mode = "Active" }
}

variable "extra_env" {
  type    = map(string)
  default = {}
}

data "archive_file" "market" {
  type        = "zip"
  source_dir  = "${path.root}/lambda_src/market/dist"
  output_path = "${path.root}/.terraform/lambda_zips/market.zip"
}

resource "aws_lambda_function" "market" {
  function_name    = "${var.name_prefix}-market"
  role             = aws_iam_role.lambda.arn
  handler          = "index.handler"
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  timeout          = 15
  memory_size      = 256
  filename         = data.archive_file.market.output_path
  source_code_hash = data.archive_file.market.output_base64sha256
  environment { variables = merge(local.common_env, {
    UPSTASH_REDIS_REST_URL   = lookup(var.extra_env, "UPSTASH_REDIS_REST_URL", "")
    UPSTASH_REDIS_REST_TOKEN = lookup(var.extra_env, "UPSTASH_REDIS_REST_TOKEN", "")
    GROQ_API_KEY             = lookup(var.extra_env, "GROQ_API_KEY", "")
    OPENROUTER_API_KEY       = lookup(var.extra_env, "OPENROUTER_API_KEY", "")
  }) }
  vpc_config {
    subnet_ids         = local.vpc_config.subnet_ids
    security_group_ids = local.vpc_config.security_group_ids
  }

  tracing_config { mode = "Active" }
}

resource "aws_cloudwatch_log_group" "market_logs" {
  name              = "/aws/lambda/${aws_lambda_function.market.function_name}"
  retention_in_days = 30
}


data "archive_file" "economic" {
  type        = "zip"
  source_dir  = "${path.root}/lambda_src/economic/dist"
  output_path = "${path.root}/.terraform/lambda_zips/economic.zip"
}

resource "aws_lambda_function" "economic" {
  function_name    = "${var.name_prefix}-economic"
  role             = aws_iam_role.lambda.arn
  handler          = "index.handler"
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  timeout          = 15
  memory_size      = 256
  filename         = data.archive_file.economic.output_path
  source_code_hash = data.archive_file.economic.output_base64sha256
  environment { variables = merge(local.common_env, {
    UPSTASH_REDIS_REST_URL   = lookup(var.extra_env, "UPSTASH_REDIS_REST_URL", "")
    UPSTASH_REDIS_REST_TOKEN = lookup(var.extra_env, "UPSTASH_REDIS_REST_TOKEN", "")
    GROQ_API_KEY             = lookup(var.extra_env, "GROQ_API_KEY", "")
    OPENROUTER_API_KEY       = lookup(var.extra_env, "OPENROUTER_API_KEY", "")
  }) }
  vpc_config {
    subnet_ids         = local.vpc_config.subnet_ids
    security_group_ids = local.vpc_config.security_group_ids
  }

  tracing_config { mode = "Active" }
}

resource "aws_cloudwatch_log_group" "economic_logs" {
  name              = "/aws/lambda/${aws_lambda_function.economic.function_name}"
  retention_in_days = 30
}


data "archive_file" "news_extra" {
  type        = "zip"
  source_dir  = "${path.root}/lambda_src/news_extra/dist"
  output_path = "${path.root}/.terraform/lambda_zips/news_extra.zip"
}

resource "aws_lambda_function" "news_extra" {
  function_name    = "${var.name_prefix}-news-extra"
  role             = aws_iam_role.lambda.arn
  handler          = "index.handler"
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  timeout          = 30
  memory_size      = 256
  filename         = data.archive_file.news_extra.output_path
  source_code_hash = data.archive_file.news_extra.output_base64sha256
  environment { variables = merge(local.common_env, {
    UPSTASH_REDIS_REST_URL   = lookup(var.extra_env, "UPSTASH_REDIS_REST_URL", "")
    UPSTASH_REDIS_REST_TOKEN = lookup(var.extra_env, "UPSTASH_REDIS_REST_TOKEN", "")
    GROQ_API_KEY             = lookup(var.extra_env, "GROQ_API_KEY", "")
    OPENROUTER_API_KEY       = lookup(var.extra_env, "OPENROUTER_API_KEY", "")
  }) }
  vpc_config {
    subnet_ids         = local.vpc_config.subnet_ids
    security_group_ids = local.vpc_config.security_group_ids
  }

  tracing_config { mode = "Active" }
}

resource "aws_cloudwatch_log_group" "news_extra_logs" {
  name              = "/aws/lambda/${aws_lambda_function.news_extra.function_name}"
  retention_in_days = 30
}


data "archive_file" "research" {
  type        = "zip"
  source_dir  = "${path.root}/lambda_src/research/dist"
  output_path = "${path.root}/.terraform/lambda_zips/research.zip"
}

resource "aws_lambda_function" "research" {
  function_name    = "${var.name_prefix}-research"
  role             = aws_iam_role.lambda.arn
  handler          = "index.handler"
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  timeout          = 20
  memory_size      = 256
  filename         = data.archive_file.research.output_path
  source_code_hash = data.archive_file.research.output_base64sha256
  environment { variables = merge(local.common_env, {
    UPSTASH_REDIS_REST_URL   = lookup(var.extra_env, "UPSTASH_REDIS_REST_URL", "")
    UPSTASH_REDIS_REST_TOKEN = lookup(var.extra_env, "UPSTASH_REDIS_REST_TOKEN", "")
    GROQ_API_KEY             = lookup(var.extra_env, "GROQ_API_KEY", "")
    OPENROUTER_API_KEY       = lookup(var.extra_env, "OPENROUTER_API_KEY", "")
  }) }
  vpc_config {
    subnet_ids         = local.vpc_config.subnet_ids
    security_group_ids = local.vpc_config.security_group_ids
  }

  tracing_config { mode = "Active" }
}

resource "aws_cloudwatch_log_group" "research_logs" {
  name              = "/aws/lambda/${aws_lambda_function.research.function_name}"
  retention_in_days = 30
}


data "archive_file" "climate" {
  type        = "zip"
  source_dir  = "${path.root}/lambda_src/climate/dist"
  output_path = "${path.root}/.terraform/lambda_zips/climate.zip"
}

resource "aws_lambda_function" "climate" {
  function_name    = "${var.name_prefix}-climate"
  role             = aws_iam_role.lambda.arn
  handler          = "index.handler"
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  timeout          = 10
  memory_size      = 128
  filename         = data.archive_file.climate.output_path
  source_code_hash = data.archive_file.climate.output_base64sha256
  environment { variables = merge(local.common_env, {
    UPSTASH_REDIS_REST_URL   = lookup(var.extra_env, "UPSTASH_REDIS_REST_URL", "")
    UPSTASH_REDIS_REST_TOKEN = lookup(var.extra_env, "UPSTASH_REDIS_REST_TOKEN", "")
    GROQ_API_KEY             = lookup(var.extra_env, "GROQ_API_KEY", "")
    OPENROUTER_API_KEY       = lookup(var.extra_env, "OPENROUTER_API_KEY", "")
  }) }
  vpc_config {
    subnet_ids         = local.vpc_config.subnet_ids
    security_group_ids = local.vpc_config.security_group_ids
  }

  tracing_config { mode = "Active" }
}

resource "aws_cloudwatch_log_group" "climate_logs" {
  name              = "/aws/lambda/${aws_lambda_function.climate.function_name}"
  retention_in_days = 30
}


data "archive_file" "supply_chain" {
  type        = "zip"
  source_dir  = "${path.root}/lambda_src/supply_chain/dist"
  output_path = "${path.root}/.terraform/lambda_zips/supply_chain.zip"
}

resource "aws_lambda_function" "supply_chain" {
  function_name    = "${var.name_prefix}-supply-chain"
  role             = aws_iam_role.lambda.arn
  handler          = "index.handler"
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  timeout          = 10
  memory_size      = 128
  filename         = data.archive_file.supply_chain.output_path
  source_code_hash = data.archive_file.supply_chain.output_base64sha256
  environment { variables = merge(local.common_env, {
    UPSTASH_REDIS_REST_URL   = lookup(var.extra_env, "UPSTASH_REDIS_REST_URL", "")
    UPSTASH_REDIS_REST_TOKEN = lookup(var.extra_env, "UPSTASH_REDIS_REST_TOKEN", "")
    GROQ_API_KEY             = lookup(var.extra_env, "GROQ_API_KEY", "")
    OPENROUTER_API_KEY       = lookup(var.extra_env, "OPENROUTER_API_KEY", "")
  }) }
  vpc_config {
    subnet_ids         = local.vpc_config.subnet_ids
    security_group_ids = local.vpc_config.security_group_ids
  }

  tracing_config { mode = "Active" }
}

resource "aws_cloudwatch_log_group" "supply_chain_logs" {
  name              = "/aws/lambda/${aws_lambda_function.supply_chain.function_name}"
  retention_in_days = 30
}

variable "extra_secrets" {
  type    = map(string)
  default = {}
}

data "archive_file" "infrastructure" {
  type        = "zip"
  source_dir  = "${path.root}/lambda_src/infrastructure/dist"
  output_path = "${path.root}/.terraform/lambda_zips/infrastructure.zip"
}

resource "aws_lambda_function" "infrastructure" {
  function_name    = "${var.name_prefix}-infrastructure"
  role             = aws_iam_role.lambda.arn
  handler          = "index.handler"
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  timeout          = 20
  memory_size      = 256
  filename         = data.archive_file.infrastructure.output_path
  source_code_hash = data.archive_file.infrastructure.output_base64sha256

  environment { variables = local.common_env }

  vpc_config {
    subnet_ids         = local.vpc_config.subnet_ids
    security_group_ids = local.vpc_config.security_group_ids
  }

  tracing_config { mode = "Active" }
}

resource "aws_cloudwatch_log_group" "infrastructure_logs" {
  name              = "/aws/lambda/${aws_lambda_function.infrastructure.function_name}"
  retention_in_days = 30
}
