#!/bin/bash
# CloudShell, us-east-1. List then delete Aurora so it stops billing.
# Does not touch YucgOutreach-dev / EC2 / SQLite.
set -euo pipefail
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-us-east-1}"

echo "== Aurora clusters =="
aws rds describe-db-clusters --query 'DBClusters[?starts_with(Engine, `aurora`)].[DBClusterIdentifier,Engine,Status,DeletionProtection]' --output table || true

echo "== DB instances (Aurora writers/readers too) =="
aws rds describe-db-instances --query 'DBInstances[?starts_with(Engine, `aurora`)].[DBInstanceIdentifier,Engine,DBInstanceStatus,DBClusterIdentifier]' --output table || true

echo "== cluster snapshots (these also bill) =="
aws rds describe-db-cluster-snapshots --query 'DBClusterSnapshots[].[DBClusterSnapshotIdentifier,DBClusterIdentifier,Status,SnapshotType]' --output table || true

echo "== deleting Aurora instances =="
aws rds describe-db-instances --query 'DBInstances[?starts_with(Engine, `aurora`)].DBInstanceIdentifier' --output text | tr '\t' '\n' | while read -r id; do
  [ -z "$id" ] && continue
  echo "delete instance $id"
  aws rds delete-db-instance --db-instance-identifier "$id" --skip-final-snapshot --delete-automated-backups >/dev/null
done

echo "== deleting Aurora clusters =="
aws rds describe-db-clusters --query 'DBClusters[?starts_with(Engine, `aurora`)].DBClusterIdentifier' --output text | tr '\t' '\n' | while read -r id; do
  [ -z "$id" ] && continue
  echo "unlock + delete cluster $id"
  aws rds modify-db-cluster --db-cluster-identifier "$id" --no-deletion-protection --apply-immediately >/dev/null || true
  aws rds delete-db-cluster --db-cluster-identifier "$id" --skip-final-snapshot --delete-automated-backups >/dev/null
done

echo "== deleting Aurora cluster snapshots =="
aws rds describe-db-cluster-snapshots --query 'DBClusterSnapshots[?SnapshotType==`manual`].DBClusterSnapshotIdentifier' --output text | tr '\t' '\n' | while read -r id; do
  [ -z "$id" ] && continue
  echo "delete snapshot $id"
  aws rds delete-db-cluster-snapshot --db-cluster-snapshot-identifier "$id" >/dev/null || true
done

echo "== leftover Aurora =="
aws rds describe-db-clusters --query 'DBClusters[?starts_with(Engine, `aurora`)].DBClusterIdentifier' --output text || true
aws rds describe-db-instances --query 'DBInstances[?starts_with(Engine, `aurora`)].DBInstanceIdentifier' --output text || true
echo "Delete is async. Wait a few minutes, then re-run the leftover lines. Live site is SQLite on the box, not Aurora."
