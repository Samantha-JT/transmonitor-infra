variable "name_prefix" {}
variable "vpc_id" {}
variable "private_subnet_ids" { type = list(string) }

resource "aws_security_group" "lambda_vpc" {
  name        = "${var.name_prefix}-lambda-vpc-sg"
  description = "VPC-attached Lambdas"
  vpc_id      = var.vpc_id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.name_prefix}-lambda-vpc-sg" }
}

resource "aws_security_group" "redis" {
  name        = "${var.name_prefix}-redis-sg"
  description = "Allow VPC Lambdas to reach ElastiCache on TLS port"
  vpc_id      = var.vpc_id

  ingress {
    description     = "Redis TLS from Lambda SG"
    from_port       = 6380
    to_port         = 6380
    protocol        = "tcp"
    security_groups = [aws_security_group.lambda_vpc.id]
  }

  ingress {
    description     = "Redis from Lambda SG port 6379"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.lambda_vpc.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.name_prefix}-redis-sg" }
}

resource "aws_elasticache_subnet_group" "redis" {
  name       = "${var.name_prefix}-redis-subnet-group"
  subnet_ids = var.private_subnet_ids
  tags       = { Name = "${var.name_prefix}-redis-subnet-group" }
}

resource "aws_elasticache_replication_group" "redis" {
  replication_group_id = "${var.name_prefix}-redis"
  description          = "TransMonitor Redis cache"

  node_type          = "cache.t4g.micro"
  num_cache_clusters = 1
  engine             = "redis"
  engine_version     = "7.1"
  port               = 6379

  subnet_group_name  = aws_elasticache_subnet_group.redis.name
  security_group_ids = [aws_security_group.redis.id]

  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  transit_encryption_mode    = "required"

  auto_minor_version_upgrade = true
  maintenance_window         = "sun:05:00-sun:06:00"
  snapshot_retention_limit   = 1
  snapshot_window            = "04:00-05:00"

  tags = { Name = "${var.name_prefix}-redis" }
}

output "endpoint" { value = aws_elasticache_replication_group.redis.primary_endpoint_address }
output "lambda_sg_id" { value = aws_security_group.lambda_vpc.id }
