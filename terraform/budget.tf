# Weekly compute-cost check. AWS Budgets has no native weekly period (only
# Daily/Monthly/Quarterly/Annually), so this fills that gap: an EventBridge
# schedule invokes a small Lambda that queries Cost Explorer for the trailing
# 7 days, scoped to EC2 + Bedrock (the two services capable of a real
# surprise - a left-on instance, a runaway model loop), and emails via SNS
# when the total crosses a threshold. The existing $100/mo AWS Budget already
# covers the whole account; this is a tighter, faster-firing check on the
# two lines that can actually spike.
#
# Default threshold reasoning: live Cost Explorer data pulled 2026-09-17
# shows a current baseline of roughly $5/week (EC2 ~$0.42/day, Bedrock light
# usage under a dollar/week). $20/week gives ~4x headroom above that
# baseline - room for normal Bedrock usage growth without false-alarming,
# while still catching a genuine runaway well before it becomes a real bill.
variable "weekly_compute_alert_email" {
  type        = string
  description = "Address to notify when trailing 7-day EC2+Bedrock spend exceeds the threshold."
}
variable "weekly_compute_threshold_usd" {
  type    = number
  default = 20
}

data "archive_file" "budget_lambda" {
  type        = "zip"
  source_file = "${path.module}/lambda-budget/handler.py"
  output_path = "${path.module}/lambda-budget/handler.zip"
}

# AWS-managed key, no extra cost - this fixes a real Trivy finding (AWS-0095)
# on a resource this session created, unlike the backups bucket encryption
# finding below, which reflects live state that predates this Terraform.
resource "aws_sns_topic" "weekly_compute_alert" {
  name              = "yucg-weekly-compute-alert"
  kms_master_key_id = "alias/aws/sns"
}
resource "aws_sns_topic_subscription" "weekly_compute_alert_email" {
  topic_arn = aws_sns_topic.weekly_compute_alert.arn
  protocol  = "email"
  endpoint  = var.weekly_compute_alert_email
}

resource "aws_iam_role" "budget_lambda" {
  name = "yucg-weekly-budget-lambda"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}
resource "aws_iam_role_policy" "budget_lambda" {
  name = "yucg-weekly-budget-lambda"
  role = aws_iam_role.budget_lambda.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "CostExplorerReadOnly"
        Effect   = "Allow"
        Action   = "ce:GetCostAndUsage"
        Resource = "*"
      },
      {
        Sid      = "PublishAlert"
        Effect   = "Allow"
        Action   = "sns:Publish"
        Resource = aws_sns_topic.weekly_compute_alert.arn
      },
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:${var.region}:${var.account_id}:log-group:/aws/lambda/yucg-weekly-budget:*"
      },
    ]
  })
}

resource "aws_lambda_function" "weekly_budget" {
  function_name    = "yucg-weekly-budget"
  role             = aws_iam_role.budget_lambda.arn
  handler          = "handler.handler"
  runtime          = "python3.12"
  timeout          = 30
  memory_size      = 128
  filename         = data.archive_file.budget_lambda.output_path
  source_code_hash = data.archive_file.budget_lambda.output_base64sha256
  environment {
    variables = {
      ALERT_TOPIC_ARN      = aws_sns_topic.weekly_compute_alert.arn
      WEEKLY_THRESHOLD_USD = tostring(var.weekly_compute_threshold_usd)
    }
  }
}

resource "aws_cloudwatch_log_group" "weekly_budget" {
  name              = "/aws/lambda/yucg-weekly-budget"
  retention_in_days = 90
}

resource "aws_cloudwatch_event_rule" "weekly_budget" {
  name                = "yucg-weekly-budget-check"
  description         = "Every Monday 12:00 UTC: check trailing 7-day EC2+Bedrock spend."
  schedule_expression = "cron(0 12 ? * MON *)"
}
resource "aws_cloudwatch_event_target" "weekly_budget" {
  rule = aws_cloudwatch_event_rule.weekly_budget.name
  arn  = aws_lambda_function.weekly_budget.arn
}
resource "aws_lambda_permission" "weekly_budget_eventbridge" {
  statement_id  = "AllowEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.weekly_budget.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.weekly_budget.arn
}

output "weekly_budget_alert_topic" { value = aws_sns_topic.weekly_compute_alert.arn }
