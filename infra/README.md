# YUCG Outreach AWS

One HTTPS `AppUrl` (CloudFront) in front of the club app. **Nothing ships from a laptop.**

**Branches (only these three):** push anything to `develop` (no required checks). PR `develop` → `feature` (tests). PR `feature` → `main` (tests + Docker build). Live AppUrl updates when `main` moves (`ship` in [`ci.yml`](../.github/workflows/ci.yml), OIDC).

CloudShell is on/off, secrets, and one-time AWS bootstrap. Same process as localhost: Vite SPA + FastAPI in `docker/app.Dockerfile`. SQLite on a retained 8 GB volume. No ALB, no Amplify, no NAT. Do not set `VITE_API_URL`.

## GitHub Actions runners

No self-hosted runner. Repo **Settings → Actions → General**: allow Actions and GitHub-hosted runners. One workflow: [`.github/workflows/ci.yml`](../.github/workflows/ci.yml). Protect `feature` (verify jobs) and `main` (verify + `build-image`). Do not require `ship` on PRs.

## Modes (one template)

| Mode | What AWS does | Rough host $ |
|------|----------------|--------------|
| **On** (always-on template) | Instance running, drain/reply jobs in-process | ~$24–28/mo + Bedrock |
| **Off** | `stop-instances` (keep EBS). AppUrl HTML may fail until start. Mail does not drain. | ~$6–8/mo (disk) |

Do **not** put the web app on Lambda + API Gateway: Find and Studio can exceed the 29s API Gateway timeout. Do **not** use Aurora as the always-on DB: 0.5 ACU 24/7 is ~$44/mo, more than this box. Aurora min-0 is a later “off ≈ $0 DB” option after Postgres cutover (`db_compat.py`), not the default.

## First time (CloudShell, us-east-1) — pipeline only

No Docker on your laptop. CloudShell deploys the **pipeline** stack (no `DockerImageAsset`). CodeBuild has privileged Docker and builds `docker/app.Dockerfile`.

1. In **Developer Tools → Connections**, connect GitHub (console click, once).
2. CloudShell:

```bash
cd /tmp
git clone -b develop https://github.com/Andylol111/client-affairs-tools.git yucg
cd yucg/infra
npm install
npx cdk bootstrap
npx cdk deploy YucgPipeline-dev -c env=dev -c githubConnectionArn=<arn-from-step-1>
```

Do not retarget that pipeline to `main` if an Actions `ship` job is about to replace it — two ships at once.

3. Pipeline runs: build image → deploy app stack (`YucgOutreach-dev`) → outputs `AppUrl`.
4. Google + Bedrock as below. `curl -sS "$AppUrl/api/health"`.

If the pipeline stack is not in the repo yet, the fallback is still AWS-only: CloudShell `cdk deploy` of `YucgOutreach-dev` **inside CloudShell** (AWS’s CDK+Docker path). Never `./start-all.sh` or laptop `cdk`.

## On / off (CloudShell)

Preferred — HostControl Lambda (output `HostControlFunctionName`):

```bash
FN=$(aws cloudformation describe-stacks --stack-name YucgOutreach-dev \
  --query "Stacks[0].Outputs[?OutputKey=='HostControlFunctionName'].OutputValue" --output text)
aws lambda invoke --function-name "$FN" --payload '{"action":"start"}' /tmp/hc.json && cat /tmp/hc.json
# {"action":"stop"}  — off, keeps EBS
# {"action":"status"}
```

Same as:

```bash
ID=$(aws cloudformation describe-stacks --stack-name YucgOutreach-dev \
  --query "Stacks[0].Outputs[?OutputKey=='InstanceId'].OutputValue" --output text)
aws ec2 start-instances --instance-ids "$ID"
aws ec2 stop-instances --instance-ids "$ID"
```

Optional at deploy time:

- `-c officeHours=1` — EventBridge start Mon–Fri 12:00 UTC, stop Tue–Sat 04:00 UTC
- `-c idleStop=1` — CloudWatch CPU &lt;5% for 8 hours invokes HostControl **stop**

A `CPUCreditBalance` alarm exists for the console only (t3 credits). Do not terminate the instance.

## After the app stack exists

Outputs: `AppUrl`, `GoogleRedirectUri`, `AppSecretsArn`, `CatalogBucket`, `InstanceId`.

1. Merge Google client id/secret into `yucg-outreach/dev/app` (**keep `JWT_SECRET`**).
2. Google Cloud: redirect = `GoogleRedirectUri`, JS origin = `AppUrl`.
3. Bedrock Anthropic FTU in `us-east-1`.
4. Login at `AppUrl` (`@yale.edu`).

Optional secret keys: Apify, Tavily, Slack, Verifalia. `INBOX_VERIFY_MODE=mx` is forced on the box.

No SSH. Session Manager if the box is up and sick. After a secret change: Session Manager `sudo /usr/local/bin/yucg-run.sh`.

## Ship a website change (no laptop)

1. Push to `develop`.
2. PR `develop` → `feature`. Wait for verify.
3. PR `feature` → `main`. Wait for verify + `build-image`. Merge. The `ci` run on `main` continues to `ship`.

### Replace CodeBuild with Actions ship (CloudShell, once)

Does not replace the EC2 instance.

```bash
cd /tmp/yucg/infra && git pull
npx cdk deploy YucgGithubOidc-dev -c env=dev
# Output GitHubShipRoleArn → repo Settings → Secrets and variables → Actions → Variables
# Name: AWS_SHIP_ROLE_ARN
```

The `ship` job in [`ci.yml`](../.github/workflows/ci.yml) builds the image, pushes ECR `:live`, and SSM-restarts the **existing** box. It does **not** `cdk deploy YucgOutreach-dev` (that replaces the instance and breaks the VPC origin + attached SQLite volume). After one green `ship` job:

```bash
npx cdk destroy YucgPipeline-dev -c env=dev --force
```

Do not leave CodePipeline and Actions ship both armed — they will double-deploy.

If `cdk deploy YucgGithubOidc-dev` fails because `token.actions.githubusercontent.com` already exists in the account, the OIDC provider is already there; import it or reuse that provider ARN in the stack before retrying.

CloudShell is not in the daily loop after that.

Workbook / corpus live in **S3**, not in the image (`data/` is docker-excluded). From CloudShell, copy **from the clone on AWS**, not from a laptop upload:

```bash
BUCKET=$(aws cloudformation describe-stacks --stack-name YucgOutreach-dev \
  --query "Stacks[0].Outputs[?OutputKey=='CatalogBucket'].OutputValue" --output text)
cd /tmp/yucg && git pull
aws s3 cp data/YUCG_Prospect_List.xlsx "s3://$BUCKET/prospects/current.xlsx"
# then start the instance if off; restart container so Week drops the local xlsx cache
```

SQLite backup: on the **running** instance (role can write the catalog bucket):

```bash
aws s3 cp /data/clientreach.db "s3://$BUCKET/exports/clientreach-$(date +%F).db"
```

Secrets merge:

```bash
ARN=$(aws cloudformation describe-stacks --stack-name YucgOutreach-dev \
  --query "Stacks[0].Outputs[?OutputKey=='AppSecretsArn'].OutputValue" --output text)
aws secretsmanager get-secret-value --secret-id "$ARN" --query SecretString --output text > /tmp/sec.json
# edit /tmp/sec.json — do not remove JWT_SECRET
aws secretsmanager put-secret-value --secret-id "$ARN" --secret-string file:///tmp/sec.json
rm /tmp/sec.json
```

## Why not Express Mode + ALB + RDS

ALB is billed while “off.” RDS/Aurora 24/7 costs more than SQLite on this disk. Express Mode was the expensive host we replaced. Horizontal scale (two tasks) is when you add Aurora + ALB.

## Cost (us-east-1, list)

| Line | On 24/7 | Off (stopped) |
|------|---------|----------------|
| t3.small | ~$15 | $0 |
| EBS 20+8 gp3 | ~$2 | ~$2 |
| EIP | ~$4 | ~$4 |
| CloudFront + S3 + logs + secrets | ~$3–6 | ~$3–6 |
| **Host** | **~$24–28** | **~$6–12** |
| Bedrock | usage | $0 if nobody calls |
| CodeBuild | cents per ship | $0 |

No NAT, WAF, Multi-AZ, Bedrock Knowledge Bases.

## Leave-the-club transfer

Personal GitHub (`Andylol111/client-affairs-tools`) and a personal AWS account are temporary. The next officer should not need your laptop, your Pro card, or a CodeStar connection only your GitHub user can refresh.

**Now (this semester):** add a second AWS IAM user (next officer) who can use CloudShell for on/off and secrets.

**When you leave:**

1. **GitHub** — Settings → Transfer repository to a YUCG org with **two Owners**. Personal Pro is not required if the repo is public or the org is Team. GitHub Enterprise is not a free club toggle (Yale CIO Campus Program only).
2. **AWS** — create a **club** account (root email the club owns). Invite the successor as IAM admin. Move `YucgOutreach-dev`, secret `yucg-outreach/dev/app`, catalog bucket, CloudFront, retained EBS (SQLite). Do not make your personal root the forever host.
3. **Google OAuth** — transfer the Google Cloud project to a club Google account, or recreate the Web client and merge the new id/secret into Secrets Manager. **Keep `JWT_SECRET`.**
4. **Ship** — prefer Actions + AWS OIDC (org Admin + one IAM role). CodePipeline’s GitHub Connection dies with your login.
