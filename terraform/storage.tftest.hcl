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
    error_message = "Default configuration must not create new opt-in storage."
  }
  assert {
    condition     = length(aws_cloudfront_distribution.website) == 0
    error_message = "Default configuration must not adopt CloudFront."
  }
  assert {
    condition     = aws_s3_bucket.backups.bucket == "yucgbak442429446212"
    error_message = "The live backup bucket must be tracked regardless of enable_new_storage - that flag governs creating NEW storage, not the already-approved backup bucket."
  }
  assert {
    condition     = aws_s3_bucket_public_access_block.backups.block_public_acls && aws_s3_bucket_public_access_block.backups.block_public_policy && aws_s3_bucket_public_access_block.backups.ignore_public_acls && aws_s3_bucket_public_access_block.backups.restrict_public_buckets
    error_message = "The backup bucket must block public access even when new opt-in storage is disabled."
  }
  assert {
    condition     = alltrue([for r in aws_s3_bucket_server_side_encryption_configuration.backups.rule : r.apply_server_side_encryption_by_default[0].sse_algorithm == "AES256"])
    error_message = "The backup bucket must stay AES256-encrypted, matching the live bucket (not KMS, which the separate state bucket uses)."
  }
}

run "private_storage_contract" {
  command = plan
  variables {
    enable_new_storage = true
  }
  assert {
    condition     = toset(keys(aws_s3_bucket.storage)) == toset(["static", "documents"])
    error_message = "Expected the new-storage pool to hold only the not-yet-approved static and document buckets; the backup bucket is tracked separately since it is already live."
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
