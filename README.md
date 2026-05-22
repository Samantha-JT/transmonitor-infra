# transmonitor-infra

Terraform for the Transmonitor serverless stack on AWS + Cloudflare.

**Stack:** Cloudflare (WAF/CDN/routing) · API Gateway HTTP API · Lambda (Node 22 ARM64) · ElastiCache Serverless Redis · S3 (static site + digest cache) · SSM Parameter Store · EventBridge

No CloudFront. No EC2. No containers in production.

---

## Architecture

```
Browser
  └── Cloudflare (WAF, DDoS, rate limit, HTTPS)
        ├── /* ──────────────────► S3 static website  (Vite SPA)
        └── /api/* ──────────────► API Gateway HTTP API
                                        ├── GET  /digest/:variant   ► feed-digest λ
                                        ├── POST /insights          ► ai-insights λ
                                        ├── GET  /rights/:country   ► trans-rights λ
                                        ├── GET  /video/:channelId  ► youtube-proxy λ
                                        └── GET  /health            ► health λ

EventBridge cron(*/15) ──────────────► feed-ingestor λ
                                              ├── writes ► S3 digest cache
                                              └── warms  ► ElastiCache Redis

feed-digest / ai-insights / feed-ingestor run inside VPC to reach Redis.
trans-rights / youtube-proxy / health run outside VPC (no cold-start ENI penalty).
```

---

## Prerequisites

- AWS CLI configured (`aws configure` or `AWS_PROFILE`)
- Cloudflare API token with `Zone:DNS:Edit`, `Zone:Firewall Services:Edit`, `Zone:Page Rules:Edit` permissions
- Terraform 1.6+
- Node 22 (for Lambda builds)

---

## First deploy

### 1. Bootstrap state backend (once only)

```bash
cd bootstrap
terraform init
terraform apply
cd ..
```

### 2. Initialise main stack

```bash
terraform init
```

### 3. Create tfvars

```bash
cp transmonitor.tfvars.example transmonitor.tfvars
# Edit: hostname, cloudflare_zone_id, cloudflare_api_token, origin_verify_secret, API keys
# Generate origin_verify_secret: openssl rand -hex 32
```

`transmonitor.tfvars` is gitignored — never commit it.

### 4. Build Lambda handlers

```bash
# From the monorepo root
npm run build:lambda
```

This compiles `lambda_src/*/index.mjs` (or your TypeScript source) into the directories Terraform archives.

### 5. Apply

```bash
cd transmonitor-infra
terraform plan  -var-file=transmonitor.tfvars
terraform apply -var-file=transmonitor.tfvars
```

Note the outputs:

```
api_gateway_invoke_url = "https://xxxx.execute-api.eu-west-1.amazonaws.com"
s3_bucket_name         = "transmonitor-prod-static"
s3_website_endpoint    = "transmonitor-prod-static.s3-website-eu-west-1.amazonaws.com"
```

### 6. Build and upload frontend

```bash
# From monorepo root
VITE_VARIANT=trans VITE_API_BASE=https://your.hostname/api npm run build
aws s3 sync dist/ s3://transmonitor-prod-static/ \
  --delete \
  --cache-control "public,max-age=31536000,immutable" \
  --exclude "index.html"
aws s3 cp dist/index.html s3://transmonitor-prod-static/index.html \
  --cache-control "no-cache,no-store,must-revalidate"
```

### 7. Verify

```bash
curl https://your.hostname/health
# {"status":"ok","service":"transmonitor-api",...}

curl https://your.hostname/api/digest/trans
# {"variant":"trans","timestamp":"...","items":[...]}
```

---

## Ongoing deployments

CI handles this automatically (`.github/workflows/deploy.yml`) on push to `trans-variant-foundation`.

For manual Lambda-only deploys:

```bash
npm run build:lambda
terraform apply -var-file=transmonitor.tfvars -target=module.lambdas
```

---

## Cost estimate

| Resource               | ~Monthly cost     |
|------------------------|-------------------|
| Lambda invocations     | $0.50–2.00        |
| ElastiCache Serverless | $2–5              |
| S3 (both buckets)      | <$0.10            |
| NAT Gateway            | ~$3.50            |
| API Gateway            | ~$0.50            |
| EventBridge            | <$0.01            |
| **Total**              | **~$7–12/mo**     |

vs EC2 t4g.small: ~$14/mo

---

## Directory structure

```
transmonitor-infra/
├── bootstrap/              One-time: S3 bucket + DynamoDB lock table
├── modules/
│   ├── networking/         VPC, private/public subnets, NAT GW
│   ├── static_site/        S3 website bucket + digest cache bucket
│   ├── cache/              ElastiCache Serverless Redis + security groups
│   ├── ssm/                SSM SecureString parameters
│   ├── lambdas/            All Lambda functions + IAM role + log groups
│   ├── api_gateway/        HTTP API + routes + Lambda integrations
│   ├── scheduler/          EventBridge rule → feed-ingestor
│   └── cloudflare/         DNS, origin rules, WAF rate limit
├── lambda_src/             Stub handlers (replaced by CI build output)
│   ├── feed-digest/
│   ├── ai-insights/
│   ├── trans-rights/
│   ├── youtube-proxy/
│   ├── feed-ingestor/
│   └── health/
├── .github/workflows/      GitHub Actions deploy pipeline
├── main.tf                 Module wiring
├── variables.tf
├── outputs.tf
├── versions.tf             Provider pins + S3 backend config
└── transmonitor.tfvars.example
```
