#!/usr/bin/env bash
set -euo pipefail
mkdir -p /tmp/terraform-bin
curl -fsSL https://releases.hashicorp.com/terraform/1.10.5/terraform_1.10.5_linux_amd64.zip -o /tmp/yucg-terraform.zip
echo '0566a24f5332098b15716ebc394be503f4094acba5ba529bf5eb0698ed5e2a90  /tmp/yucg-terraform.zip' | sha256sum -c -
unzip -o /tmp/yucg-terraform.zip -d /tmp/terraform-bin
echo /tmp/terraform-bin >> "$GITHUB_PATH"
