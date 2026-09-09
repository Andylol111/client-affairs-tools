#!/bin/bash
# Render only IMAGE/AWS_REGION/YUCG_ENV/ECR_HOST via envsubst. Requires digest image.
set -euo pipefail
[[ "${IMAGE}" =~ @sha256:[a-f0-9]{64}$ ]] || { echo 'Immutable image digest required'; exit 1; }
mountpoint -q /data || { echo 'Retained /data volume is not mounted; refusing deployment'; exit 1; }
[ -f /data/clientreach.db ] || { echo 'Existing database missing; use reviewed bootstrap for first deployment'; exit 1; }
[ -s /etc/yucg/app.env ]
exec 9>/var/lock/yucg-deploy.lock
flock -n 9 || { echo 'Deployment already running'; exit 1; }
OLD_IMAGE=$(docker inspect --format '{{.Image}}' yucg)
OLD_MOUNT=$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}' yucg)
[ "$OLD_MOUNT" = /data ] || { echo 'Unexpected current database mount'; exit 1; }
aws ecr get-login-password --region "${AWS_REGION}" | docker login --username AWS --password-stdin "${ECR_HOST}"
docker pull "${IMAGE}"
# SQLite online backup accounts for WAL; no raw copy of a live database.
install -d -m 0700 /data/backups
BACKUP="/data/backups/predeploy-$(date -u +%Y%m%dT%H%M%SZ).db"
docker exec -e BACKUP="$BACKUP" yucg python -c 'import os,sqlite3; s=sqlite3.connect("/data/clientreach.db"); d=sqlite3.connect(os.environ["BACKUP"]); s.backup(d); assert d.execute("PRAGMA integrity_check").fetchone()[0]=="ok"; d.close(); s.close()'
run_image() {
  docker rm -f yucg >/dev/null 2>&1 || true
  docker run -d --name yucg --restart unless-stopped --env-file /etc/yucg/app.env \
    -p 80:8000 -v /data:/data --log-driver=awslogs \
    --log-opt awslogs-region="${AWS_REGION}" --log-opt awslogs-group="/yucg-outreach/${YUCG_ENV}" \
    --log-opt awslogs-stream=api "$1"
}
healthy() {
  for attempt in $(seq 1 30); do
    if curl --fail --silent --max-time 3 http://127.0.0.1/api/health >/dev/null && \
       docker exec yucg python -c 'import sqlite3; c=sqlite3.connect("file:/data/clientreach.db?mode=rw",uri=True); assert c.execute("PRAGMA quick_check").fetchone()[0]=="ok"; c.execute("SELECT count(*) FROM users"); c.close()'; then return 0; fi
    sleep 2
  done
  return 1
}
if ! run_image "${IMAGE}" || ! healthy; then
  echo 'Release failed; restoring previous image. Database is not automatically rolled back.'
  run_image "$OLD_IMAGE"
  healthy || { echo 'CRITICAL: previous image also unhealthy; manual restore review required'; exit 2; }
  exit 1
fi
# Persist the exact successful image for operator restarts.
printf '%s\n' "${IMAGE}" > /etc/yucg/current-image
cat > /usr/local/bin/yucg-run.sh <<'RUNNER'
#!/bin/bash
set -euo pipefail
mountpoint -q /data
[ -f /data/clientreach.db ]
docker rm -f yucg >/dev/null 2>&1 || true
docker run -d --name yucg --restart unless-stopped --env-file /etc/yucg/app.env \
  -p 80:8000 -v /data:/data --log-driver=awslogs \
  --log-opt awslogs-region="${AWS_REGION}" --log-opt awslogs-group="/yucg-outreach/${YUCG_ENV}" \
  --log-opt awslogs-stream=api "$(cat /etc/yucg/current-image)"
RUNNER
chmod 0755 /usr/local/bin/yucg-run.sh
printf 'Healthy release; backup retained at %s\n' "$BACKUP"
