#!/bin/bash
# CloudShell, us-east-1. Stops CodeBuild billing. Does not touch YucgOutreach-dev.
set -euo pipefail
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-us-east-1}"

echo "== stop IN_PROGRESS CodeBuild =="
ids="$(aws codebuild list-builds --query 'ids[:40]' --output text 2>/dev/null || true)"
if [ -n "${ids:-}" ] && [ "$ids" != "None" ]; then
  # shellcheck disable=SC2086
  aws codebuild batch-get-builds --ids $ids --query 'builds[].[id,buildStatus]' --output text | while read -r id st; do
    echo "$st $id"
    if [ "$st" = "IN_PROGRESS" ]; then
      aws codebuild stop-build --id "$id" >/dev/null
      echo "stopped $id"
    fi
  done
else
  echo "no recent builds"
fi

echo "== delete YucgPipeline-dev (CodePipeline + CodeBuild ship) =="
if aws cloudformation describe-stacks --stack-name YucgPipeline-dev >/dev/null 2>&1; then
  aws cloudformation delete-stack --stack-name YucgPipeline-dev
  echo "delete started for YucgPipeline-dev"
else
  echo "YucgPipeline-dev not present"
fi

echo "== Amplify: turn off auto-build (Amplify runs on CodeBuild) =="
aws amplify list-apps --query 'apps[].[appId,name]' --output text | while read -r app_id name; do
  [ -z "${app_id:-}" ] && continue
  echo "amplify $name $app_id"
  aws amplify list-branches --app-id "$app_id" --query 'branches[].branchName' --output text | tr '\t' '\n' | while read -r br; do
    [ -z "$br" ] && continue
    aws amplify update-branch --app-id "$app_id" --branch-name "$br" --no-enable-auto-build >/dev/null || true
  done
  case "$(echo "$name" | tr '[:upper:]' '[:lower:]')" in
    *yucg*|*client-affair*|*outreach*)
      aws amplify delete-app --app-id "$app_id"
      echo "deleted amplify $name"
      ;;
  esac
done

echo "== CodeBuild projects still in the account =="
aws codebuild list-projects --output json
echo "Done. Live site is CloudFront. Ship is GitHub Actions. Do not recreate YucgPipeline-dev."
