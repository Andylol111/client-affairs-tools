#!/usr/bin/env bash
set -euo pipefail
mkdir -p /tmp/terraform-bin
# releases.hashicorp.com resets the connection often enough to fail a run
# ("curl: (35) Recv failure"), and a dropped download is not a verification
# result. Retry, then let the checksum decide whether what arrived is real.
curl -fsSL --retry 5 --retry-all-errors --retry-delay 3 --connect-timeout 15 --max-time 180 \
  https://releases.hashicorp.com/terraform/1.10.5/terraform_1.10.5_linux_amd64.zip \
  -o /tmp/yucg-terraform.zip
echo '0566a24f5332098b15716ebc394be503f4094acba5ba529bf5eb0698ed5e2a90  /tmp/yucg-terraform.zip' | sha256sum -c -
unzip -o /tmp/yucg-terraform.zip -d /tmp/terraform-bin
echo /tmp/terraform-bin >> "$GITHUB_PATH"
