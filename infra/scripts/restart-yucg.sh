#!/bin/bash
# Runs on the box via SSM. ship.yml envsubst: IMAGE, AWS_REGION, YUCG_ENV, ECR_HOST
set -euo pipefail
DATA=/data
[ -d /data ] || DATA=/var/lib/yucg
aws ecr get-login-password --region "${AWS_REGION}" \
  | docker login --username AWS --password-stdin "${ECR_HOST}"
docker pull "${IMAGE}"
cat > /usr/local/bin/yucg-run.sh <<EOF
#!/bin/bash
set -euo pipefail
docker rm -f yucg >/dev/null 2>&1 || true
docker run -d --name yucg --restart unless-stopped \\
  --env-file /etc/yucg/app.env \\
  -p 80:8000 \\
  -v ${DATA}:/data \\
  --log-driver=awslogs \\
  --log-opt awslogs-region=${AWS_REGION} \\
  --log-opt awslogs-group=/yucg-outreach/${YUCG_ENV} \\
  --log-opt awslogs-stream=api \\
  ${IMAGE}
EOF
chmod +x /usr/local/bin/yucg-run.sh
/usr/local/bin/yucg-run.sh
