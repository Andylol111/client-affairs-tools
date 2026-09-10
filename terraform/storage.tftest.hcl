mock_provider "aws" {}

variables {
  account_id      = "123456789012"
  bucket_prefix   = "yucg-contract-test"
  frontend_origin = "https://club.example.org"
}

run "disabled_by_default" {
  command = plan
  assert {
    condition     = length(aws_s3_bucket.storage) == 0
    error_message = "Default configuration must not create storage."
  }
  assert {
    condition     = length(aws_cloudfront_distribution.website) == 0
    error_message = "Default configuration must not adopt CloudFront."
  }
}

run "private_storage_contract" {
  command = plan
  variables {
    enable_new_storage = true
  }
  assert {
    condition     = toset(keys(aws_s3_bucket.storage)) == toset(["static", "documents", "backups"])
    error_message = "Expected separate static, document and backup buckets."
  }
  assert {
    condition     = alltrue([for b in aws_s3_bucket_public_access_block.storage : b.block_public_acls && b.block_public_policy && b.ignore_public_acls && b.restrict_public_buckets])
    error_message = "Every data bucket must block public access."
  }
  assert {
    condition     = alltrue([for b in aws_s3_bucket_versioning.storage : b.versioning_configuration[0].status == "Enabled"])
    error_message = "Versioning is mandatory."
  }
  assert {
    condition     = alltrue([for b in aws_s3_bucket_server_side_encryption_configuration.storage : alltrue([for r in b.rule : r.apply_server_side_encryption_by_default[0].sse_algorithm == "AES256"])])
    error_message = "Storage must remain encrypted."
  }
  assert {
    condition     = one(aws_s3_bucket_cors_configuration.documents[0].cors_rule).allowed_origins == toset(["https://club.example.org"])
    error_message = "Document CORS must allow only the configured frontend origin."
  }
}

run "reject_wildcard_browser_origin" {
  command = plan
  variables {
    frontend_origin = "*"
  }
  expect_failures = [var.frontend_origin]
}
