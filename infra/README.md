# YUCG Outreach on AWS

Operator notes for the live host. Members use [`README.md`](../README.md) and `AppUrl`.

Stack: `YucgOutreach-dev` in `us-east-1`. Image: `docker/app.Dockerfile`. SQLite: `/data/clientreach.db` on a retained 8 GB volume. HTTPS: CloudFront VPC origin. No ALB, NAT, Amplify, or Aurora.

**Do not** `cdk deploy YucgOutreach-dev`. User-data is baked into the instance (`userDataCausesReplacement: true`). A deploy mints a new box; CloudFront cannot rebind the VPC origin and the SQLite volume is already attached. Website updates are GitHub **Beta** (`feature`) or **Production** (`main`) via ECR + SSM restart. Never CodeBuild.

**CodeBuild is not used.** Ship is GitHub Actions. If AWS is charging for CodeBuild, paste `infra/scripts/stop-codebuild.sh` in CloudShell now. That deletes `YucgPipeline-dev` and leftover Amplify apps. Do not recreate them.

## GitHub

Repo **Settings → Actions → General**: allow GitHub-hosted runners. Stage workflows: [Intake](../.github/workflows/intake.yml), [Beta](../.github/workflows/beta.yml), [Production](../.github/workflows/production.yml). Required check name: `required-checks`.

The local workflow now runs validation on topic PRs and pushes, with `required-checks` as the aggregate gate. Configure required review and this check in repository settings; the old `gate-branch` check was removed. Production jobs reference the `production` environment, which must have verified reviewers and main-only deployment rules.

The proposed ship-role trust expects `repo:Andylol111/client-affairs-tools:environment:production`. Verify and review the deployed IAM trust before shipping; do not assume the local CDK change has been applied. See [current implementation status](../docs/IMPLEMENTATION-STATUS.md) and [live cutover checks](../docs/LIVE-CUTOVER-CHECKS.md).

## On / off (CloudShell)

```bash
FN=$(aws cloudformation describe-stacks --stack-name YucgOutreach-dev \
  --query "Stacks[0].Outputs[?OutputKey=='HostControlFunctionName'].OutputValue" --output text)
aws lambda invoke --function-name "$FN" --payload '{"action":"start"}' /tmp/hc.json && cat /tmp/hc.json
# {"action":"stop"}   keeps EBS; mail jobs do not run
# {"action":"status"}
```

Do not terminate the instance. Optional at first deploy only: `-c officeHours=1`, `-c idleStop=1`.

| Mode | What runs | Rough host $ |
|------|-----------|--------------|
| On | Instance + drain/reply in-process | ~$24–28/mo + Bedrock |
| Off | Stopped, disk kept | ~$6–12/mo |

Find and Studio can exceed API Gateway’s 29s limit — do not put the app on Lambda + API Gateway. Aurora 24/7 costs more than this box.

## After the stack exists

Outputs: `AppUrl`, `GoogleRedirectUri`, `AppSecretsArn`, `CatalogBucket`, `InstanceId`.

1. Merge Google client id/secret into `yucg-outreach/dev/app`. **Keep `JWT_SECRET`.**
2. Google Cloud: redirect = `GoogleRedirectUri`, JS origin = `AppUrl`. Enable Gmail API.
3. Bedrock Anthropic first-time use in `us-east-1`.
4. Login at `AppUrl` (`@yale.edu`).

Optional secret keys: Apify, Tavily, Slack, Verifalia. `INBOX_VERIFY_MODE=mx` is forced on the box. No SSH. Session Manager if the box is up and sick.

```bash
ARN=$(aws cloudformation describe-stacks --stack-name YucgOutreach-dev \
  --query "Stacks[0].Outputs[?OutputKey=='AppSecretsArn'].OutputValue" --output text)
aws secretsmanager get-secret-value --secret-id "$ARN" --query SecretString --output text > /tmp/sec.json
# edit /tmp/sec.json — do not remove JWT_SECRET
aws secretsmanager put-secret-value --secret-id "$ARN" --secret-string file:///tmp/sec.json
rm /tmp/sec.json
```

Workbook / corpus live in **S3**, not in the image (`data/` is docker-excluded). Copy from a clone **on AWS**, not a laptop upload:

```bash
BUCKET=$(aws cloudformation describe-stacks --stack-name YucgOutreach-dev \
  --query "Stacks[0].Outputs[?OutputKey=='CatalogBucket'].OutputValue" --output text)
cd /tmp/yucg && git pull
aws s3 cp data/YUCG_Prospect_List.xlsx "s3://$BUCKET/prospects/current.xlsx"
```

For SQLite backups, use `infra/scripts/backup_sqlite.py` for an online consistent snapshot and isolated restore rehearsal. Do not copy only the running `.db` file: WAL transactions may be omitted. The optional approved S3 upload and timer sequence is documented in [Terraform operations](../terraform/README.md#opt-in-operational-scripts).

## First box (rare)

Only if `YucgOutreach-dev` does not exist. CloudShell, not a laptop:

```bash
cd /tmp && git clone https://github.com/Andylol111/client-affairs-tools.git yucg
cd yucg/infra && npm install && npx cdk bootstrap
npx cdk deploy YucgOutreach-dev -c env=dev
npx cdk deploy YucgGithubOidc-dev -c env=dev
```

Then set `AWS_SHIP_ROLE_ARN` from output `GitHubShipRoleArn`. After that, never deploy the app stack again unless you intend to replace the instance.

## Cost (us-east-1, list)

| Line | On 24/7 | Off |
|------|---------|-----|
| t3.small | ~$15 | $0 |
| EBS 20+8 gp3 | ~$2 | ~$2 |
| Public IP (egress) | ~$4 | ~$4 |
| CloudFront + S3 + logs + secrets | ~$3–6 | ~$3–6 |
| **Host** | **~$24–28** | **~$6–12** |
| Bedrock | usage | $0 if idle |

No NAT, WAF, Multi-AZ, Bedrock Knowledge Bases.

## Leave-the-club transfer

Personal GitHub and a personal AWS account are temporary. Add a second IAM user this semester.

When you leave: transfer the repo to a YUCG org (two Owners); move the stack, secret `yucg-outreach/dev/app`, catalog bucket, CloudFront, and retained EBS to a club AWS account; move the Google Cloud project or recreate the OAuth client (**keep `JWT_SECRET`**). Ship stays Actions + OIDC.
