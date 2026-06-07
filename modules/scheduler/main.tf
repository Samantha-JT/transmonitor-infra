variable "name_prefix" {}
variable "feed_ingestor_function_arn" {}
variable "feed_ingestor_function_name" {}

# ── EventBridge Scheduler (replaces legacy aws_cloudwatch_event_rule) ─────────
# Uses the native Scheduler resource which supports retry policies and DLQs.

resource "aws_sqs_queue" "feed_ingestor_dlq" {
  name                      = "${var.name_prefix}-feed-ingestor-dlq"
  message_retention_seconds = 1209600 # 14 days
  tags                      = { Name = "${var.name_prefix}-feed-ingestor-dlq" }
}

resource "aws_iam_role" "scheduler" {
  name = "${var.name_prefix}-scheduler-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "scheduler.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "scheduler" {
  name = "${var.name_prefix}-scheduler-policy"
  role = aws_iam_role.scheduler.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = "lambda:InvokeFunction"
        Resource = var.feed_ingestor_function_arn
      },
      {
        Effect   = "Allow"
        Action   = "sqs:SendMessage"
        Resource = aws_sqs_queue.feed_ingestor_dlq.arn
      }
    ]
  })
}

resource "aws_scheduler_schedule" "feed_ingestor" {
  name       = "${var.name_prefix}-feed-ingestor"
  group_name = "default"

  flexible_time_window {
    mode                      = "FLEXIBLE"
    maximum_window_in_minutes = 5
  }

  schedule_expression          = "cron(0/15 * * * ? *)"
  schedule_expression_timezone = "UTC"

  target {
    arn      = var.feed_ingestor_function_arn
    role_arn = aws_iam_role.scheduler.arn

    retry_policy {
      maximum_event_age_in_seconds = 3600
      maximum_retry_attempts       = 2
    }

    dead_letter_config {
      arn = aws_sqs_queue.feed_ingestor_dlq.arn
    }
  }
}

# ── Outputs ───────────────────────────────────────────────────────────────────

output "dlq_url" { value = aws_sqs_queue.feed_ingestor_dlq.url }
