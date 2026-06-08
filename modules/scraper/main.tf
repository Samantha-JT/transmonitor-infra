# ── Archive S3 bucket ─────────────────────────────────────────────────────────
resource "aws_s3_bucket" "archive" {
  bucket = "${var.name_prefix}-archive"
}

resource "aws_s3_bucket_public_access_block" "archive" {
  bucket                  = aws_s3_bucket.archive.id
  block_public_acls       = true
  ignore_public_acls      = true
  block_public_policy     = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "archive" {
  bucket = aws_s3_bucket.archive.id

  rule {
    id     = "glacier-after-90-days"
    status = "Enabled"

    filter {
      prefix = "screenshots/"
    }

    transition {
      days          = 90
      storage_class = "GLACIER"
    }
  }
}

# ── IAM role ──────────────────────────────────────────────────────────────────
resource "aws_iam_role" "scraper" {
  name = "transmonitor-hansard-scraper"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.scraper.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy" "s3_access" {
  name = "s3-hansard-upload"
  role = aws_iam_role.scraper.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = ["s3:PutObject", "s3:GetObject", "s3:PutObjectTagging"]
        Resource = [
          "arn:aws:s3:::${var.name_prefix}-static/*",
          "${aws_s3_bucket.archive.arn}/*",
        ]
      },
      {
        Effect = "Allow"
        Action = "s3:ListBucket"
        Resource = [
          "arn:aws:s3:::${var.name_prefix}-static",
          aws_s3_bucket.archive.arn,
        ]
      }
    ]
  })
}

resource "aws_iam_instance_profile" "scraper" {
  name = "transmonitor-hansard-scraper"
  role = aws_iam_role.scraper.name
}

# ── EC2 instance ──────────────────────────────────────────────────────────────
data "aws_ami" "al2023_arm64" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-*-arm64"]
  }

  filter {
    name   = "state"
    values = ["available"]
  }
}

resource "aws_instance" "scraper" {
  ami                  = data.aws_ami.al2023_arm64.id
  instance_type        = "t4g.small"
  subnet_id            = var.subnet_id
  iam_instance_profile = aws_iam_instance_profile.scraper.name

  root_block_device {
    volume_size = 60
    volume_type = "gp3"
  }

  tags = {
    Name = "${var.name_prefix}-hansard-scraper"
  }

  lifecycle {
    ignore_changes = [ami] # don't replace instance on AMI updates
  }
}
