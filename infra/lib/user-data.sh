#!/bin/bash
# First boot: mount retained data volume, pull image, write env, start container.
set -euo pipefail
dnf install -y docker jq xfsprogs
systemctl enable --now docker

install -d -m 0755 /etc/yucg
DATA_DEV=""
for _ in $(seq 1 30); do
  for d in /dev/nvme1n1 /dev/xvdf; do
    if [ -b "$d" ]; then DATA_DEV=$d; break; fi
  done
  [ -n "$DATA_DEV" ] && break
  sleep 2
done
if [ -n "$DATA_DEV" ]; then
  DATA_DIR=/data
  install -d -m 0755 "$DATA_DIR"
  if ! blkid "$DATA_DEV" >/dev/null 2>&1; then
    mkfs.xfs -f "$DATA_DEV"
  fi
  grep -q " $DATA_DIR " /etc/fstab || echo "$DATA_DEV $DATA_DIR xfs defaults,nofail 0 2" >> /etc/fstab
  mount -a
else
  echo "Retained data volume missing; refusing root-volume fallback"
  exit 1
fi

mountpoint -q /data || { echo "Retained data mount failed"; exit 1; }

aws ecr get-login-password --region "$YUCG_REGION" | docker login --username AWS --password-stdin "$YUCG_ECR"
docker pull "$YUCG_IMAGE"

PUBLIC_URL=""
# VPC origin + distribution often land 10–15 min after the instance starts.
for _ in $(seq 1 90); do
  PUBLIC_URL=$(aws ssm get-parameter --region "$YUCG_REGION" --name "$YUCG_PUBLIC_PARAM" --query Parameter.Value --output text 2>/dev/null || true)
  if [ -n "$PUBLIC_URL" ] && [ "$PUBLIC_URL" != "None" ]; then
    break
  fi
  sleep 15
done
if [ -z "$PUBLIC_URL" ] || [ "$PUBLIC_URL" = "None" ]; then
  echo "public URL parameter missing; Google OAuth needs the CloudFront HTTPS name"
  exit 1
fi

SECRET_JSON=$(aws secretsmanager get-secret-value --region "$YUCG_REGION" --secret-id "$YUCG_SECRET_ARN" --query SecretString --output text)
umask 077
{
  echo "$SECRET_JSON" | jq -r 'to_entries[] | select(.value != null) | "\(.key)=\(.value)"'
  echo "DATABASE_URL=sqlite:////data/clientreach.db"
  echo "LLM_PROVIDER=bedrock"
  echo "BEDROCK_RANK_MODEL_ID=us.anthropic.claude-3-5-haiku-20241022-v1:0"
  echo "AI_REVIEW_WORKERS=2"
  echo "INBOX_VERIFY_MODE=mx"
  echo "CATALOG_BUCKET=$YUCG_BUCKET"
  echo "AWS_REGION=$YUCG_REGION"
  echo "AWS_DEFAULT_REGION=$YUCG_REGION"
  echo "FRONTEND_DIST=/app/frontend_dist"
  echo "FRONTEND_URL=$PUBLIC_URL"
  echo "BACKEND_URL=$PUBLIC_URL"
  echo "CORS_ORIGINS=$PUBLIC_URL"
  echo "GOOGLE_REDIRECT_URI=$PUBLIC_URL/api/auth/google/callback"
} > /etc/yucg/app.env

cat > /usr/local/bin/yucg-run.sh <<EOS
#!/bin/bash
set -euo pipefail
docker rm -f yucg >/dev/null 2>&1 || true
docker run -d --name yucg --restart unless-stopped \\
  --env-file /etc/yucg/app.env \\
  -p 80:8000 \\
  -v $DATA_DIR:/data \\
  --log-driver=awslogs \\
  --log-opt awslogs-region=$YUCG_REGION \\
  --log-opt awslogs-group=$YUCG_LOG_GROUP \\
  --log-opt awslogs-stream=api \\
  $YUCG_IMAGE
EOS
chmod +x /usr/local/bin/yucg-run.sh
/usr/local/bin/yucg-run.sh
