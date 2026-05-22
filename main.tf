locals {
  name_prefix = "transmonitor-${var.environment}"
}

module "networking" {
  source      = "./modules/networking"
  name_prefix = local.name_prefix
  aws_region  = var.aws_region
}

module "ssm" {
  source               = "./modules/ssm"
  name_prefix          = local.name_prefix
  groq_api_key         = var.groq_api_key
  openrouter_api_key   = var.openrouter_api_key
  acled_email          = var.acled_email
  acled_password       = var.acled_password
  finnhub_api_key      = var.finnhub_api_key
  fred_api_key         = var.fred_api_key
  nasa_firms_api_key   = var.nasa_firms_api_key
  origin_verify_secret = var.origin_verify_secret
}

module "static_site" {
  source      = "./modules/static_site"
  name_prefix = local.name_prefix
  hostname    = var.hostname
}

module "cache" {
  source             = "./modules/cache"
  name_prefix        = local.name_prefix
  vpc_id             = module.networking.vpc_id
  private_subnet_ids = module.networking.private_subnet_ids
}

module "lambdas" {
  extra_secrets = {
    GROQ_API_KEY       = var.groq_api_key
    OPENROUTER_API_KEY = var.openrouter_api_key
  }
  extra_env = {
    UPSTASH_REDIS_REST_URL   = var.upstash_redis_rest_url
    UPSTASH_REDIS_REST_TOKEN = var.upstash_redis_rest_token
    GROQ_API_KEY             = var.groq_api_key
    OPENROUTER_API_KEY       = var.openrouter_api_key
  }
  source               = "./modules/lambdas"
  name_prefix          = local.name_prefix
  aws_region           = var.aws_region
  vpc_id               = module.networking.vpc_id
  private_subnet_ids   = module.networking.private_subnet_ids
  lambda_sg_id         = module.cache.lambda_sg_id
  redis_endpoint       = module.cache.endpoint
  digest_bucket_name   = module.static_site.digest_bucket_name
  ssm_prefix           = module.ssm.prefix
  origin_verify_secret = var.origin_verify_secret
}

module "api_gateway" {
  source                = "./modules/api_gateway"
  name_prefix           = local.name_prefix
  hostname              = var.hostname
  origin_verify_secret  = var.origin_verify_secret
  lambda_invoke_arns    = module.lambdas.invoke_arns
  lambda_function_names = module.lambdas.function_names
}

module "scheduler" {
  source                      = "./modules/scheduler"
  name_prefix                 = local.name_prefix
  feed_ingestor_function_arn  = module.lambdas.feed_ingestor_arn
  feed_ingestor_function_name = module.lambdas.feed_ingestor_name
}

module "cloudflare" {
  account_id           = var.cloudflare_account_id
  source               = "./modules/cloudflare"
  zone_id              = var.cloudflare_zone_id
  hostname             = var.hostname
  api_gateway_url      = module.api_gateway.invoke_url
  s3_website_endpoint  = module.static_site.website_endpoint
  origin_verify_secret = var.origin_verify_secret
}
