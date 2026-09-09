# Opt-in adoption of the EXISTING distribution; never creates a parallel website.
variable "adopt_existing_distribution" {
  type    = bool
  default = false
}
variable "cloudformation_relinquished_distribution" {
  type        = bool
  default     = false
  description = "Set only after approved retain/relinquish handoff is verified."
}
variable "existing_distribution_id" {
  type    = string
  default = "E35QVGFDWHVOPG"
}
variable "existing_vpc_origin_id" {
  type    = string
  default = ""
}
variable "existing_backend_domain" {
  type    = string
  default = ""
}
variable "existing_origin_read_timeout" {
  type        = number
  default     = 120
  description = "Audit observed 120 seconds; confirm live configuration/quota before adoption."
}
locals { adopt_cdn = var.adopt_existing_distribution && var.enable_new_storage }
import {
  for_each = local.adopt_cdn ? { existing = var.existing_distribution_id } : {}
  to       = aws_cloudfront_distribution.website[0]
  id       = each.value
}
resource "aws_cloudfront_origin_access_control" "static" {
  count                             = local.adopt_cdn ? 1 : 0
  name                              = "${var.bucket_prefix}-static"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}
resource "aws_cloudfront_function" "spa" {
  count   = local.adopt_cdn ? 1 : 0
  name    = "${var.bucket_prefix}-spa"
  runtime = "cloudfront-js-2.0"
  publish = true
  code    = <<-JS
function handler(event) {
  var request = event.request;
  // This function is associated only with the static default behavior.
  // API paths must never receive an HTML fallback.
  if (request.uri === '/api' || request.uri.indexOf('/api/') === 0) return request;
  if (request.uri.indexOf('.') === -1) request.uri = '/index.html';
  return request;
}
JS
}
resource "aws_cloudfront_distribution" "website" {
  count               = local.adopt_cdn ? 1 : 0
  enabled             = true
  comment             = "yucg-outreach-dev"
  default_root_object = "index.html"
  is_ipv6_enabled     = true
  price_class         = "PriceClass_All"
  origin {
    origin_id                = "private-static"
    domain_name              = aws_s3_bucket.storage["static"].bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.static[0].id
    s3_origin_config { origin_access_identity = "" }
  }
  origin {
    origin_id   = "private-api"
    domain_name = var.existing_backend_domain
    vpc_origin_config {
      vpc_origin_id            = var.existing_vpc_origin_id
      origin_read_timeout      = var.existing_origin_read_timeout
      origin_keepalive_timeout = 5
    }
  }
  default_cache_behavior {
    target_origin_id       = "private-static"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    cache_policy_id        = aws_cloudfront_cache_policy.static[0].id
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.spa[0].arn
    }
  }
  dynamic "ordered_cache_behavior" {
    for_each = ["/api", "/api/*"]
    content {
      path_pattern             = ordered_cache_behavior.value
      target_origin_id         = "private-api"
      viewer_protocol_policy   = "redirect-to-https"
      allowed_methods          = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
      cached_methods           = ["GET", "HEAD"]
      compress                 = true
      cache_policy_id          = "413f160f-7d9f-4f4f-a67e-939342969e55"
      origin_request_policy_id = "b689b0a8-53d0-40ab-baf2-68738e2966ac"
    }
  }
  restrictions {
    geo_restriction { restriction_type = "none" }
  }
  viewer_certificate { cloudfront_default_certificate = true }
  lifecycle {
    prevent_destroy = true
    precondition {
      condition     = var.cloudformation_relinquished_distribution && var.existing_vpc_origin_id != "" && var.existing_backend_domain != ""
      error_message = "Verified CDK retain/relinquish handoff and exact existing VPC origin inputs required."
    }
  }
}

resource "aws_cloudfront_cache_policy" "static" {
  count       = local.adopt_cdn ? 1 : 0
  name        = "${var.bucket_prefix}-static"
  min_ttl     = 0
  default_ttl = 300
  max_ttl     = 31536000
  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_gzip   = true
    enable_accept_encoding_brotli = true
    cookies_config { cookie_behavior = "none" }
    headers_config { header_behavior = "none" }
    query_strings_config { query_string_behavior = "none" }
  }
}
