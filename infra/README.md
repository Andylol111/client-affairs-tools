# YUCG Outreach AWS

One HTTPS `AppUrl` (CloudFront) in front of the club app. **Nothing ships from a laptop.** GitHub is the source; **CodeBuild** builds the image; the box runs it; CloudShell is only on/off, secrets, and the first pipeline bootstrap.

Same process as localhost: Vite SPA + FastAPI in `docker/app.Dockerfile`. SQLite on a retained 8 GB volume. No ALB, no Amplify, no NAT. Do not set `VITE_API_URL`.

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
git clone -b yucg-outreach https://github.com/Andylol111/client-affairs-tools.git yucg
cd yucg/infra
npm install
npx cdk bootstrap
npx cdk deploy YucgPipeline-dev -c env=dev -c githubConnectionArn=<arn-from-step-1>
```

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

Push to `yucg-outreach` (or the branch the pipeline tracks). CodeBuild builds and deploys. CloudShell is not in that loop.

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
