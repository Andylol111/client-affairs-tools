#!/bin/bash
# CloudShell, us-east-1. Stops CodePipeline V2 + CodeBuild billing.
# Does not touch YucgOutreach-dev (the live CloudFront box).
set -euo pipefail
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-us-east-1}"

echo "== CodePipeline names =="
aws codepipeline list-pipelines --query 'pipelines[].name' --output text || true

echo "== abandon IN_PROGRESS CodePipeline executions =="
for name in $(aws codepipeline list-pipelines --query 'pipelines[].name' --output text 2>/dev/null || true); do
  [ -z "$name" ] && continue
  echo "pipeline $name"
  eids="$(aws codepipeline list-pipeline-executions --pipeline-name "$name" --query 'pipelineExecutionSummaries[?status==`InProgress`].pipelineExecutionId' --output text 2>/dev/null || true)"
  for eid in $eids; do
    [ -z "$eid" ] && continue
    aws codepipeline stop-pipeline-execution --pipeline-name "$name" --pipeline-execution-id "$eid" --abandon --reason "stop free-tier burn" >/dev/null
    echo "abandoned $name $eid"
  done
done

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

echo "== delete YucgPipeline-dev (this is the V2 pipeline + CodeBuild project) =="
if aws cloudformation describe-stacks --stack-name YucgPipeline-dev >/dev/null 2>&1; then
  aws cloudformation delete-stack --stack-name YucgPipeline-dev
  echo "delete started for YucgPipeline-dev"
else
  echo "YucgPipeline-dev not present"
fi

echo "== Amplify auto-build off (Amplify is CodeBuild) =="
aws amplify list-apps --query 'apps[].[appId,name]' --output text 2>/dev/null | while read -r app_id name; do
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

echo "== leftover pipelines / CodeBuild projects =="
aws codepipeline list-pipelines --output json || true
aws codebuild list-projects --output json || true
echo "Done. Live site is CloudFront. Ship is GitHub Actions. Do not recreate YucgPipeline-dev."
