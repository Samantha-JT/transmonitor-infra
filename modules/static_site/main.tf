variable "name_prefix" {}
variable "hostname"    {}

resource "aws_s3_bucket" "site" {
  bucket = "${var.name_prefix}-static"
  tags   = { Name = "${var.name_prefix}-static" }
}

resource "aws_s3_bucket_website_configuration" "site" {
  bucket = aws_s3_bucket.site.id

  index_document { suffix = "index.html" }
  error_document { key    = "index.html" }
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
    Statement = [{
      Effect    = "Allow"
      Principal = "*"
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.site.arn}/*"
    }]
  })
}

resource "aws_s3_bucket_cors_configuration" "site" {
  bucket = aws_s3_bucket.site.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET"]
    allowed_origins = ["https://${var.hostname}"]
    max_age_seconds = 3600
  }
}

# Separate bucket for feed digest cache — not public
resource "aws_s3_bucket" "digest_cache" {
  bucket = "${var.name_prefix}-digest-cache"
  tags   = { Name = "${var.name_prefix}-digest-cache" }
}

resource "aws_s3_bucket_versioning" "digest_cache" {
  bucket = aws_s3_bucket.digest_cache.id
  versioning_configuration { status = "Enabled" }
}

output "bucket_name"       { value = aws_s3_bucket.site.id }
output "digest_bucket_name" { value = aws_s3_bucket.digest_cache.id }
output "website_endpoint"  { value = aws_s3_bucket_website_configuration.site.website_endpoint }
