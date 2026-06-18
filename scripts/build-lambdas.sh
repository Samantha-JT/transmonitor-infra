#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR="$(dirname "$SCRIPT_DIR")"
SRC_DIR="$INFRA_DIR/lambda_src"
ESBUILD="$INFRA_DIR/node_modules/.bin/esbuild"

FUNCTIONS=(feed-digest ai-insights trans-rights youtube-proxy feed-ingestor health rss-proxy youtube-live youtube-latest news-digest sentiment-stats tmm-data media-bias news_extra archive-lookup)

for fn in "${FUNCTIONS[@]}"; do
  echo "→ Building $fn..."
  DIST="$SRC_DIR/$fn/dist"
  mkdir -p "$DIST"

  # Bundle as CJS — avoids ESM/CJS interop issues with redis
  ENTRY=""
  if [ -f "$SRC_DIR/$fn/index.mjs" ]; then
    ENTRY="$fn/index.mjs"
  elif [ -f "$SRC_DIR/$fn/index.ts" ]; then
    ENTRY="$fn/index.ts"
  else
    echo "   ✗ $fn: no index.mjs or index.ts found"
    continue
  fi
  (cd "$SRC_DIR" && "$ESBUILD" "$ENTRY" \
    --bundle \
    --platform=node \
    --target=node22 \
    --format=cjs \
    --outfile="$fn/dist/index.js" \
    --external:@aws-sdk/* \
    --external:redis \
    --log-level=warning)

  # Copy redis node_modules into the dist zip payload
  cp -r "$SRC_DIR/node_modules" "$DIST/node_modules"

  echo "   ✓ $fn"
done

echo "All Lambda functions built."
