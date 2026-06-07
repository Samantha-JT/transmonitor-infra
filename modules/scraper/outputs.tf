output "instance_id" {
  value = aws_instance.scraper.id
}

output "archive_bucket_name" {
  value = aws_s3_bucket.archive.id
}

output "archive_bucket_arn" {
  value = aws_s3_bucket.archive.arn
}
