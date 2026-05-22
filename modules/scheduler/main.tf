variable "name_prefix"                  {}
variable "feed_ingestor_function_arn"   {}
variable "feed_ingestor_function_name"  {}

resource "aws_cloudwatch_event_rule" "feed_ingestor" {
  name                = "${var.name_prefix}-feed-ingestor"
  description         = "Trigger feed-ingestor every 15 minutes"
  schedule_expression = "cron(0/15 * * * ? *)"
  state               = "ENABLED"
}

resource "aws_cloudwatch_event_target" "feed_ingestor" {
  rule = aws_cloudwatch_event_rule.feed_ingestor.name
  arn  = var.feed_ingestor_function_arn
}

resource "aws_lambda_permission" "eventbridge" {
  statement_id  = "AllowEventBridgeInvoke"
  action        = "lambda:InvokeFunction"
  function_name = var.feed_ingestor_function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.feed_ingestor.arn
}
