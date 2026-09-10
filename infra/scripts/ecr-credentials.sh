#!/usr/bin/env bash
# Source after AWS OIDC/instance credentials are available. Never calls docker login.
set -euo pipefail
command -v docker-credential-ecr-login >/dev/null || {
  echo 'Install amazon-ecr-credential-helper before accessing ECR.' >&2; exit 1;
}
[[ "${ECR_HOST:-}" =~ ^[0-9]{12}\.dkr\.ecr\.[a-z0-9-]+\.amazonaws\.com$ ]] || exit 1
export DOCKER_CONFIG
DOCKER_CONFIG="$(mktemp -d)"
chmod 0700 "$DOCKER_CONFIG"
export AWS_ECR_DISABLE_CACHE=true
printf '{"credHelpers":{"%s":"ecr-login"}}\n' "$ECR_HOST" > "$DOCKER_CONFIG/config.json"
chmod 0600 "$DOCKER_CONFIG/config.json"
# Only this freshly created directory is removed, even on failure.
trap 'rm -rf -- "$DOCKER_CONFIG"' EXIT
