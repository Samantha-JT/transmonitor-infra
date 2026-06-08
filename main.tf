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
  openrouter_api_key   = var.openrouter_api_key
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
  pushover_token       = var.pushover_token
  pushover_user        = var.pushover_user
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
  source               = "./modules/cloudflare"
  account_id           = var.cloudflare_account_id
  zone_id              = var.cloudflare_zone_id
  hostname             = var.hostname
  api_gateway_url      = module.api_gateway.invoke_url
  s3_website_endpoint  = module.static_site.website_endpoint
  origin_verify_secret = var.origin_verify_secret
  cf_api_token         = var.cloudflare_api_token
  pushover_token       = var.pushover_token
  pushover_user        = var.pushover_user
}

module "scraper" {
  source      = "./modules/scraper"
  name_prefix = local.name_prefix
  subnet_id   = module.networking.private_subnet_ids[0]
}
