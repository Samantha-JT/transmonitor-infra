output "api_gateway_invoke_url" {
  description = "Set this as the /api/* origin in Cloudflare"
  value       = module.api_gateway.invoke_url
}

output "s3_website_endpoint" {
  description = "Set this as the /* origin in Cloudflare"
  value       = module.static_site.website_endpoint
}

output "s3_bucket_name" {
  description = "Upload built Vite assets here"
  value       = module.static_site.bucket_name
}

output "redis_endpoint" {
  description = "ElastiCache Serverless endpoint (internal)"
  value       = module.cache.endpoint
  sensitive   = true
}
