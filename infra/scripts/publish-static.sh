#!/bin/bash
# Explicit, approved static cutover only. Uploads never delete prior release assets.
set -euo pipefail
: "${STATIC_BUCKET:?Set approved private static bucket}"
: "${STATIC_CUTOVER_APPROVED:?Set true after reviewed CloudFront cutover}"
[ "$STATIC_CUTOVER_APPROVED" = true ]
DIST_DIR="${1:?Pass verified frontend artifact directory}"
[ -s "$DIST_DIR/index.html" ]
[ -d "$DIST_DIR/assets" ]
[[ "$STATIC_BUCKET" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]]
# Vite content-hashed assets remain available for old cached entry pages.
aws s3 cp "$DIST_DIR/assets/" "s3://${STATIC_BUCKET}/assets/" --recursive \
  --cache-control 'public,max-age=31536000,immutable' --only-show-errors
aws s3 cp "$DIST_DIR/" "s3://${STATIC_BUCKET}/" --recursive --exclude 'assets/*' --exclude 'index.html' \
  --cache-control 'public,max-age=300' --only-show-errors
# Entry point is published only after every referenced asset was uploaded successfully.
aws s3 cp "$DIST_DIR/index.html" "s3://${STATIC_BUCKET}/index.html" \
  --content-type text/html --cache-control 'no-cache' --only-show-errors
if [ "${STATIC_INVALIDATION_APPROVED:-false}" = true ]; then
  : "${STATIC_DISTRIBUTION_ID:?Set approved adopted distribution}"
  aws cloudfront create-invalidation --distribution-id "$STATIC_DISTRIBUTION_ID" --paths /index.html
fi
