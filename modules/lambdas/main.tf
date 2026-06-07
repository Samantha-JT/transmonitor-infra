variable "name_prefix" {}
variable "aws_region" {}
variable "vpc_id" {}
variable "private_subnet_ids" {
  type = list(string)
}
variable "lambda_sg_id" {}
variable "redis_endpoint" {}
variable "digest_bucket_name" {}
variable "ssm_prefix" {}
variable "origin_verify_secret" {
  sensitive = true
}

variable "pushover_token" {
  type      = string
  sensitive = true
}

variable "pushover_user" {
  type      = string
  sensitive = true
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id
  region     = data.aws_region.current.name

  common_env = {
    REDIS_URL            = "rediss://${var.redis_endpoint}:6379"
    DIGEST_BUCKET        = var.digest_bucket_name
    SSM_PREFIX           = var.ssm_prefix
    NODE_ENV             = "production"
    VARIANT              = "trans"
    AWS_BEDROCK_REGION   = "eu-west-1"
    AWS_BEDROCK_MODEL_ID = "eu.anthropic.claude-haiku-4-5-20251001-v1:0"
  }

  feed_ingestor_env = merge(local.common_env, {
    FEED_TIMEOUT_MS = "5000"
    PUSHOVER_TOKEN  = var.pushover_token
    PUSHOVER_USER   = var.pushover_user
  })

  news_digest_env = merge(local.common_env, {
    PUSHOVER_TOKEN = var.pushover_token
    PUSHOVER_USER  = var.pushover_user
  })

  vpc_config = {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_sg_id]
  }

  bedrock_model_arn     = "arn:aws:bedrock:*::foundation-model/anthropic.claude-haiku*"
  bedrock_inference_arn = "arn:aws:bedrock:*:${local.account_id}:inference-profile/*"
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

resource "aws_iam_role_policy_attachment" "xray" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess"
}

resource "aws_iam_role_policy" "lambda_permissions" {
  name = "${var.name_prefix}-lambda-policy"
  role = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "DigestBucketAccess"
        Effect = "Allow"
        Action = ["s3:GetObject", "s3:PutObject", "s3:ListBucket"]
        Resource = [
          "arn:aws:s3:::${var.digest_bucket_name}",
          "arn:aws:s3:::${var.digest_bucket_name}/*"
        ]
      },
      {
        Sid    = "SSMParameterRead"
        Effect = "Allow"
        Action = ["ssm:GetParameter", "ssm:GetParametersByPath"]
        Resource = [
          "arn:aws:ssm:${local.region}:${local.account_id}:parameter${var.ssm_prefix}",
          "arn:aws:ssm:${local.region}:${local.account_id}:parameter${var.ssm_prefix}/*",
        ]
      },
      {
        Sid      = "CloudWatchLogs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:*:${local.account_id}:*"
      },
      {
        Sid    = "BedrockInvokeScoped"
        Effect = "Allow"
        Action = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"]
        Resource = [
          local.bedrock_model_arn,
          local.bedrock_inference_arn,
        ]
      }
    ]
  })
}

# ── CloudWatch log groups ─────────────────────────────────────────────────────
# Use skip_destroy so that if a log group already exists in AWS but not in
# state, the import below brings it in without Terraform trying to recreate it.

locals {
  all_function_names = [
    "${var.name_prefix}-feed-digest",
    "${var.name_prefix}-feed-ingestor",
    "${var.name_prefix}-ai-insights",
    "${var.name_prefix}-news-digest",
    "${var.name_prefix}-news-extra",
    "${var.name_prefix}-sentiment-stats",
    "${var.name_prefix}-trans-rights",
    "${var.name_prefix}-tmm-data",
    "${var.name_prefix}-rss-proxy",
    "${var.name_prefix}-health",
  ]
}

resource "aws_cloudwatch_log_group" "lambdas" {
  for_each          = toset(local.all_function_names)
  name              = "/aws/lambda/${each.key}"
  retention_in_days = 30
  skip_destroy      = true
}

# ── Archive data sources ───────────────────────────────────────────────────────

data "archive_file" "feed_digest" {
  type        = "zip"
  source_dir  = "${path.root}/lambda_src/feed-digest/dist"
  output_path = "${path.root}/.terraform/lambda_zips/feed-digest.zip"
}

data "archive_file" "feed_ingestor" {
  type        = "zip"
  source_dir  = "${path.root}/lambda_src/feed-ingestor/dist"
  output_path = "${path.root}/.terraform/lambda_zips/feed-ingestor.zip"
}

data "archive_file" "ai_insights" {
  type        = "zip"
  source_dir  = "${path.root}/lambda_src/ai-insights/dist"
  output_path = "${path.root}/.terraform/lambda_zips/ai-insights.zip"
}

data "archive_file" "news_digest" {
  type        = "zip"
  source_dir  = "${path.root}/lambda_src/news-digest/dist"
  output_path = "${path.root}/.terraform/lambda_zips/news-digest.zip"
}

data "archive_file" "news_extra" {
  type        = "zip"
  source_dir  = "${path.root}/lambda_src/news_extra/dist"
  output_path = "${path.root}/.terraform/lambda_zips/news-extra.zip"
}

data "archive_file" "sentiment_stats" {
  type        = "zip"
  source_dir  = "${path.root}/lambda_src/sentiment-stats/dist"
  output_path = "${path.root}/.terraform/lambda_zips/sentiment-stats.zip"
}

data "archive_file" "trans_rights" {
  type        = "zip"
  source_dir  = "${path.root}/lambda_src/trans-rights/dist"
  output_path = "${path.root}/.terraform/lambda_zips/trans-rights.zip"
}

data "archive_file" "tmm_data" {
  type        = "zip"
  source_dir  = "${path.root}/lambda_src/tmm-data/dist"
  output_path = "${path.root}/.terraform/lambda_zips/tmm-data.zip"
}

data "archive_file" "rss_proxy" {
  type        = "zip"
  source_dir  = "${path.root}/lambda_src/rss-proxy/dist"
  output_path = "${path.root}/.terraform/lambda_zips/rss-proxy.zip"
}

data "archive_file" "health" {
  type        = "zip"
  source_dir  = "${path.root}/lambda_src/health/dist"
  output_path = "${path.root}/.terraform/lambda_zips/health.zip"
}

# ── VPC-attached Lambdas ──────────────────────────────────────────────────────

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
  depends_on = [aws_cloudwatch_log_group.lambdas]
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
  environment { variables = local.feed_ingestor_env }
  vpc_config {
    subnet_ids         = local.vpc_config.subnet_ids
    security_group_ids = local.vpc_config.security_group_ids
  }
  tracing_config { mode = "Active" }
  depends_on = [aws_cloudwatch_log_group.lambdas]
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
  depends_on = [aws_cloudwatch_log_group.lambdas]

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }
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
  environment { variables = local.news_digest_env }
  vpc_config {
    subnet_ids         = local.vpc_config.subnet_ids
    security_group_ids = local.vpc_config.security_group_ids
  }
  tracing_config { mode = "Active" }
  depends_on = [aws_cloudwatch_log_group.lambdas]
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
  environment { variables = local.common_env }
  vpc_config {
    subnet_ids         = local.vpc_config.subnet_ids
    security_group_ids = local.vpc_config.security_group_ids
  }
  tracing_config { mode = "Active" }
  depends_on = [aws_cloudwatch_log_group.lambdas]
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
  depends_on = [aws_cloudwatch_log_group.lambdas]
}

# ── Non-VPC Lambdas ───────────────────────────────────────────────────────────

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
  depends_on = [aws_cloudwatch_log_group.lambdas]
}

resource "aws_lambda_function" "tmm_data" {
  function_name    = "${var.name_prefix}-tmm-data"
  role             = aws_iam_role.lambda.arn
  handler          = "index.handler"
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  timeout          = 60
  memory_size      = 512
  filename         = data.archive_file.tmm_data.output_path
  source_code_hash = data.archive_file.tmm_data.output_base64sha256
  environment { variables = local.common_env }
  vpc_config {
    subnet_ids         = local.vpc_config.subnet_ids
    security_group_ids = local.vpc_config.security_group_ids
  }
  tracing_config { mode = "Active" }
  depends_on = [aws_cloudwatch_log_group.lambdas]
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
  depends_on = [aws_cloudwatch_log_group.lambdas]
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
  depends_on = [aws_cloudwatch_log_group.lambdas]
}

# ── Outputs ───────────────────────────────────────────────────────────────────

output "invoke_arns" {
  value = {
    feed_digest     = aws_lambda_function.feed_digest.invoke_arn
    ai_insights     = aws_lambda_function.ai_insights.invoke_arn
    news_digest     = aws_lambda_function.news_digest.invoke_arn
    news_extra      = aws_lambda_function.news_extra.invoke_arn
    sentiment_stats = aws_lambda_function.sentiment_stats.invoke_arn
    trans_rights    = aws_lambda_function.trans_rights.invoke_arn
    tmm_data        = aws_lambda_function.tmm_data.invoke_arn
    media_bias      = aws_lambda_function.media_bias.invoke_arn
    rss_proxy       = aws_lambda_function.rss_proxy.invoke_arn
    health          = aws_lambda_function.health.invoke_arn
    security_score  = aws_lambda_function.security_score.invoke_arn
  }
}

output "function_names" {
  value = {
    feed_digest     = aws_lambda_function.feed_digest.function_name
    ai_insights     = aws_lambda_function.ai_insights.function_name
    news_digest     = aws_lambda_function.news_digest.function_name
    news_extra      = aws_lambda_function.news_extra.function_name
    sentiment_stats = aws_lambda_function.sentiment_stats.function_name
    trans_rights    = aws_lambda_function.trans_rights.function_name
    tmm_data        = aws_lambda_function.tmm_data.function_name
    media_bias      = aws_lambda_function.media_bias.function_name
    rss_proxy       = aws_lambda_function.rss_proxy.function_name
    health          = aws_lambda_function.health.function_name
    security_score  = aws_lambda_function.security_score.function_name
  }
}

output "feed_ingestor_arn" { value = aws_lambda_function.feed_ingestor.arn }
output "feed_ingestor_name" { value = aws_lambda_function.feed_ingestor.function_name }

data "archive_file" "media_bias" {
  type        = "zip"
  source_dir  = "${path.root}/lambda_src/media-bias/dist"
  output_path = "${path.root}/.terraform/lambda_zips/media-bias.zip"
}

resource "aws_lambda_function" "media_bias" {
  function_name    = "${var.name_prefix}-media-bias"
  role             = aws_iam_role.lambda.arn
  handler          = "index.handler"
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  timeout          = 60
  memory_size      = 512
  filename         = data.archive_file.media_bias.output_path
  source_code_hash = data.archive_file.media_bias.output_base64sha256
  environment { variables = local.common_env }
  vpc_config {
    subnet_ids         = local.vpc_config.subnet_ids
    security_group_ids = local.vpc_config.security_group_ids
  }
  tracing_config { mode = "Active" }
  depends_on = [aws_cloudwatch_log_group.lambdas]
}

# ── Security scoring Lambda ───────────────────────────────────────────────────

data "archive_file" "security_score" {
  type        = "zip"
  output_path = "${path.root}/.terraform/lambda_zips/security-score.zip"
  source_dir  = "${path.root}/lambdas/security-score"
}

resource "aws_cloudwatch_log_group" "security_score" {
  name              = "/aws/lambda/${var.name_prefix}-security-score"
  retention_in_days = 14
}

resource "aws_lambda_function" "security_score" {
  function_name    = "${var.name_prefix}-security-score"
  role             = aws_iam_role.lambda.arn
  handler          = "index.handler"
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  timeout          = 10
  memory_size      = 256
  filename         = data.archive_file.security_score.output_path
  source_code_hash = data.archive_file.security_score.output_base64sha256
  environment {
    variables = {
      AWS_BEDROCK_REGION   = local.common_env.AWS_BEDROCK_REGION
      AWS_BEDROCK_MODEL_ID = local.common_env.AWS_BEDROCK_MODEL_ID
      NODE_ENV             = "production"
    }
  }
  tracing_config { mode = "Active" }
  depends_on = [aws_cloudwatch_log_group.security_score]
}
