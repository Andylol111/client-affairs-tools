terraform {
  required_version = ">= 1.10, < 2.0"
  required_providers {
    aws     = { source = "hashicorp/aws", version = "~> 5.0" }
    archive = { source = "hashicorp/archive", version = "~> 2.4" }
  }
  # Supply bucket/key/region through a reviewed backend.hcl; never commit credentials.
  backend "s3" { use_lockfile = true }
}
provider "aws" {
  region              = var.region
  allowed_account_ids = [var.account_id]
  default_tags { tags = { Application = "yucg-outreach", ManagedBy = "terraform" } }
}
variable "region" { default = "us-east-1" }
variable "account_id" { type = string }
variable "enable_new_storage" {
  type        = bool
  default     = false
  description = "Explicit approval required. Does not adopt or change any existing CDK resources."
}
variable "bucket_prefix" {
  type    = string
  default = ""
}
resource "aws_s3_bucket" "storage" {
  for_each      = var.enable_new_storage ? toset(["static", "documents"]) : toset([])
  bucket        = "${var.bucket_prefix}-${each.key}"
  force_destroy = false
  lifecycle { prevent_destroy = true }
}
resource "aws_s3_bucket_public_access_block" "storage" {
  for_each                = aws_s3_bucket.storage
  bucket                  = each.value.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
resource "aws_s3_bucket_versioning" "storage" {
  for_each = aws_s3_bucket.storage
  bucket   = each.value.id
  versioning_configuration { status = "Enabled" }
}
resource "aws_s3_bucket_server_side_encryption_configuration" "storage" {
  for_each = aws_s3_bucket.storage
  bucket   = each.value.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}
resource "aws_s3_bucket_policy" "tls" {
  for_each = aws_s3_bucket.storage
  bucket   = each.value.id
  # All policy fields are input-derived and inspectable in the first saved plan.
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat([{
      Sid       = "DenyInsecureTransport"
      Effect    = "Deny"
      Action    = ["s3:*"]
      Resource  = ["arn:aws:s3:::${var.bucket_prefix}-${each.key}", "arn:aws:s3:::${var.bucket_prefix}-${each.key}/*"]
      Principal = "*"
      Condition = { Bool = { "aws:SecureTransport" = "false" } }
      }], each.key == "static" && local.adopt_cdn ? [{
      Sid       = "CloudFrontReadOnly"
      Effect    = "Allow"
      Action    = ["s3:GetObject"]
      Resource  = ["arn:aws:s3:::${var.bucket_prefix}-static/*"]
      Principal = { Service = "cloudfront.amazonaws.com" }
      Condition = { StringEquals = { "AWS:SourceArn" = "arn:aws:cloudfront::${var.account_id}:distribution/${var.existing_distribution_id}" } }
    }] : [])
  })
}
output "storage_buckets" { value = { for k, b in aws_s3_bucket.storage : k => b.id } }

# Already live, approved and installed via infra/ops/backup-bootstrap on
# 2026-09-17 (CloudShell, not this Terraform). Tracked here, unconditionally,
# so its cost/lifecycle is visible to other collaborators and it can be torn
# down deliberately - not gated behind enable_new_storage, which governs
# creating NEW storage. This resource must never disappear from a plan just
# because that flag is false; that would make Terraform want to delete a
# bucket that real backups already live in.
#
# Every argument below matches the live bucket exactly (verified via the AWS
# API before writing this) so the first plan after import is a true no-op:
# no versioning was ever enabled, encryption is AES256 (not the state
# bucket's aws:kms), no lifecycle rules, no tags.
resource "aws_s3_bucket" "backups" {
  bucket        = "yucgbak442429446212"
  force_destroy = false
  lifecycle { prevent_destroy = true }
}
resource "aws_s3_bucket_public_access_block" "backups" {
  bucket                  = aws_s3_bucket.backups.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
resource "aws_s3_bucket_server_side_encryption_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}
resource "aws_s3_bucket_policy" "backups_tls" {
  bucket = aws_s3_bucket.backups.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "DenyInsecureTransport"
      Effect    = "Deny"
      Action    = "s3:*"
      Resource  = [aws_s3_bucket.backups.arn, "${aws_s3_bucket.backups.arn}/*"]
      Principal = "*"
      Condition = { Bool = { "aws:SecureTransport" = "false" } }
    }]
  })
}
output "backups_bucket" { value = aws_s3_bucket.backups.id }

variable "frontend_origin" {
  type        = string
  description = "Exact HTTPS origin for browser document transfers; no wildcard origins."
  validation {
    condition     = can(regex("^https://[A-Za-z0-9.-]+(:[0-9]+)?$", var.frontend_origin))
    error_message = "Supply an exact HTTPS origin without a path."
  }
}
resource "aws_s3_bucket_cors_configuration" "documents" {
  count  = var.enable_new_storage ? 1 : 0
  bucket = aws_s3_bucket.storage["documents"].id
  cors_rule {
    allowed_methods = ["PUT", "GET", "HEAD"]
    allowed_origins = [var.frontend_origin]
    allowed_headers = ["Content-Type", "If-None-Match"]
    expose_headers  = ["ETag", "x-amz-version-id"]
    max_age_seconds = 300
  }
}
resource "aws_s3_bucket_lifecycle_configuration" "incomplete_uploads" {
  for_each = aws_s3_bucket.storage
  bucket   = each.value.id
  rule {
    id     = "abort-incomplete-uploads"
    status = "Enabled"
    filter { prefix = "" }
    abort_incomplete_multipart_upload { days_after_initiation = 7 }
  }
}

variable "existing_instance_role_name" {
  type        = string
  default     = "YucgOutreach-dev-BoxRoleE81F8972-xiU5VrjCgSXk"
  description = "Verified EC2 application role. Defaults to the live box role since the backup grant below already targets it; the documents grant stays separately gated behind enable_new_storage regardless of this default."
}
resource "aws_iam_role_policy" "documents" {
  count = var.enable_new_storage && var.existing_instance_role_name != "" ? 1 : 0
  name  = "yucg-documents-access"
  role  = var.existing_instance_role_name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["s3:PutObject", "s3:GetObject", "s3:GetObjectVersion"]
      Resource = "arn:aws:s3:::${var.bucket_prefix}-documents/documents/*"
    }]
  })
}
output "application_environment" {
  value       = var.enable_new_storage ? { DOCUMENTS_BUCKET = aws_s3_bucket.storage["documents"].id } : {}
  description = "Apply to reviewed app environment during document-storage cutover; keep CATALOG_BUCKET for legacy catalog."
}

# Already live and approved (infra/ops/backup-bootstrap, 2026-09-17); tracked
# here for visibility, not gated behind enable_new_storage for the same
# reason as the backups bucket above. The GetBootstrap statement is one-time
# install media access, not part of the ongoing backup path - safe to drop
# in a future change once nobody needs to re-run the bootstrap.
resource "aws_iam_role_policy" "backup_upload" {
  count = var.existing_instance_role_name != "" ? 1 : 0
  name  = "YucgBackupS3"
  role  = var.existing_instance_role_name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "PutBackups"
        Effect   = "Allow"
        Action   = "s3:PutObject"
        Resource = "${aws_s3_bucket.backups.arn}/sqlite/*"
      },
      {
        Sid      = "GetBootstrap"
        Effect   = "Allow"
        Action   = "s3:GetObject"
        Resource = "${aws_s3_bucket.backups.arn}/bootstrap/*"
      },
    ]
  })
}
variable "existing_static_publish_role_name" {
  type        = string
  default     = ""
  description = "Separately approved GitHub production-environment OIDC role for static publication."
}
resource "aws_iam_role_policy" "static_publish" {
  count = local.adopt_cdn && var.existing_static_publish_role_name != "" ? 1 : 0
  name  = "yucg-static-publish"
  role  = var.existing_static_publish_role_name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["s3:PutObject"]
      Resource = "arn:aws:s3:::${var.bucket_prefix}-static/*"
      }, {
      Effect   = "Allow"
      Action   = ["cloudfront:CreateInvalidation"]
      Resource = "arn:aws:cloudfront::${var.account_id}:distribution/${var.existing_distribution_id}"
    }]
  })
}
