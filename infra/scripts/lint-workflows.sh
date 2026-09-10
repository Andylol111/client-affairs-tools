#!/usr/bin/env bash
set -euo pipefail
curl -fsSL https://github.com/rhysd/actionlint/releases/download/v1.7.12/actionlint_1.7.12_linux_amd64.tar.gz -o /tmp/yucg-actionlint.tar.gz
echo '8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8  /tmp/yucg-actionlint.tar.gz' | sha256sum -c -
mkdir -p /tmp/yucg-workflow-lint
tar -xzf /tmp/yucg-actionlint.tar.gz -C /tmp/yucg-workflow-lint actionlint
/tmp/yucg-workflow-lint/actionlint
