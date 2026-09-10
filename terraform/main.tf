terraform {
  required_version = ">= 1.10, < 2.0"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
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
variable "bucket_prefix" { type = string }
resource "aws_s3_bucket" "storage" {
  for_each      = var.enable_new_storage ? toset(["static", "documents", "backups"]) : toset([])
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
  default     = ""
  description = "Verified EC2 application role; optional narrowly scoped new documents grant, not role adoption."
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

resource "aws_iam_role_policy" "backup_upload" {
  count = var.enable_new_storage && var.existing_instance_role_name != "" ? 1 : 0
  name  = "yucg-backup-upload"
  role  = var.existing_instance_role_name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["s3:PutObject"]
      Resource = "arn:aws:s3:::${var.bucket_prefix}-backups/sqlite/*"
    }]
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
