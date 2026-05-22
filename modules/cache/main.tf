variable "name_prefix"        {}
variable "vpc_id"             {}
variable "private_subnet_ids" { type = list(string) }

resource "aws_security_group" "redis" {
  name        = "${var.name_prefix}-redis-sg"
  description = "Allow Lambda to reach ElastiCache"
  vpc_id      = var.vpc_id

  ingress {
    from_port       = 6379
    to_port         = 6380
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

resource "aws_elasticache_serverless_cache" "redis" {
  engine = "redis"
  name   = "${var.name_prefix}-redis"

  cache_usage_limits {
    data_storage {
      maximum = 5
      unit    = "GB"
    }
    ecpu_per_second {
      maximum = 1000
    }
  }

  subnet_ids         = var.private_subnet_ids
  security_group_ids = [aws_security_group.redis.id]

  tags = { Name = "${var.name_prefix}-redis" }
}

output "endpoint"     { value = aws_elasticache_serverless_cache.redis.endpoint[0].address }
output "lambda_sg_id" { value = aws_security_group.lambda_vpc.id }
