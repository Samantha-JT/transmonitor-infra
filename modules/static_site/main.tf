variable "name_prefix" {}
variable "hostname" {}

# ── Static site bucket (public read for S3 website hosting) ──────────────────

resource "aws_s3_bucket" "site" {
  bucket = "${var.name_prefix}-static"
  tags   = { Name = "${var.name_prefix}-static" }
}

resource "aws_s3_bucket_website_configuration" "site" {
  bucket = aws_s3_bucket.site.id

  index_document { suffix = "index.html" }
  error_document { key = "index.html" }
}

resource "aws_s3_bucket_public_access_block" "site" {
  bucket = aws_s3_bucket.site.id

  block_public_acls       = false
  block_public_policy     = false
  ignore_public_acls      = false
  restrict_public_buckets = false
}

resource "aws_s3_bucket_policy" "site" {
  bucket     = aws_s3_bucket.site.id
  depends_on = [aws_s3_bucket_public_access_block.site]

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "CloudflareOnly"
        Effect    = "Allow"
        Principal = "*"
        Action    = "s3:GetObject"
        Resource  = "${aws_s3_bucket.site.arn}/*"
        Condition = {
          IpAddress = {
            "aws:SourceIp" = [
              "173.245.48.0/20",
              "103.21.244.0/22",
              "103.22.200.0/22",
              "103.31.4.0/22",
              "141.101.64.0/18",
              "108.162.192.0/18",
              "190.93.240.0/20",
              "188.114.96.0/20",
              "197.234.240.0/22",
              "198.41.128.0/17",
              "162.158.0.0/15",
              "104.16.0.0/13",
              "104.24.0.0/14",
              "172.64.0.0/13",
              "131.0.72.0/22"
            ]
          }
        }
      }
    ]
  })
}

resource "aws_s3_bucket_cors_configuration" "site" {
  bucket = aws_s3_bucket.site.id

  cors_rule {
    allowed_headers = ["Authorization", "Content-Type", "Range"]
    allowed_methods = ["GET", "HEAD"]
    allowed_origins = ["https://${var.hostname}"]
    expose_headers  = ["ETag", "Content-Length", "Content-Range"]
    max_age_seconds = 3600
  }
}

# ── Digest cache bucket (private — Lambda read/write only) ────────────────────

resource "aws_s3_bucket" "digest_cache" {
  bucket = "${var.name_prefix}-digest-cache"
  tags   = { Name = "${var.name_prefix}-digest-cache" }
}

resource "aws_s3_bucket_public_access_block" "digest_cache" {
  bucket = aws_s3_bucket.digest_cache.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "digest_cache" {
  bucket = aws_s3_bucket.digest_cache.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "digest_cache" {
  bucket = aws_s3_bucket.digest_cache.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# ── Outputs ───────────────────────────────────────────────────────────────────

output "bucket_name" { value = aws_s3_bucket.site.id }
output "digest_bucket_name" { value = aws_s3_bucket.digest_cache.id }
output "website_endpoint" { value = aws_s3_bucket_website_configuration.site.website_endpoint }
