"""Weekly compute-cost check: EC2 + Bedrock only, over a rolling 7-day window.

AWS Budgets has no native weekly period (Daily/Monthly/Quarterly/Annually
only), so this exists to fill that gap on a schedule, scoped to the two
services actually capable of a surprise (a left-on instance, a runaway
Bedrock loop) rather than the account's total bill, which the existing
$100/mo budget already covers.

Cost Explorer has reporting lag of up to ~24h, so a Monday-morning run may
undercount the trailing weekend slightly. That is a false-negative risk
(alerts a bit late), never a false positive.
"""
import json
import os
from datetime import datetime, timedelta, timezone

import boto3

ce = boto3.client("ce", region_name="us-east-1")
sns = boto3.client("sns")

SERVICES = ["Amazon Elastic Compute Cloud - Compute", "EC2 - Other"]
BEDROCK_PREFIX = "Bedrock"  # Cost Explorer lists each model as its own service name


def handler(event, context):
    threshold = float(os.environ.get("WEEKLY_THRESHOLD_USD", "20"))
    topic_arn = os.environ["ALERT_TOPIC_ARN"]

    end = datetime.now(timezone.utc).date()
    start = end - timedelta(days=7)
    resp = ce.get_cost_and_usage(
        TimePeriod={"Start": start.isoformat(), "End": end.isoformat()},
        Granularity="DAILY",
        Metrics=["UnblendedCost"],
        Filter={"Dimensions": {"Key": "RECORD_TYPE", "Values": ["Usage"]}},
        GroupBy=[{"Type": "DIMENSION", "Key": "SERVICE"}],
    )

    by_service: dict[str, float] = {}
    for row in resp["ResultsByTime"]:
        for group in row["Groups"]:
            name = group["Keys"][0]
            amount = float(group["Metrics"]["UnblendedCost"]["Amount"])
            by_service[name] = by_service.get(name, 0.0) + amount

    ec2_total = sum(v for k, v in by_service.items() if k in SERVICES)
    bedrock_total = sum(v for k, v in by_service.items() if BEDROCK_PREFIX in k)
    compute_total = ec2_total + bedrock_total

    result = {
        "window": f"{start.isoformat()} to {end.isoformat()}",
        "ec2_usd": round(ec2_total, 2),
        "bedrock_usd": round(bedrock_total, 2),
        "compute_total_usd": round(compute_total, 2),
        "threshold_usd": threshold,
        "over_threshold": compute_total > threshold,
    }
    print(json.dumps(result))

    if compute_total > threshold:
        sns.publish(
            TopicArn=topic_arn,
            Subject=f"YUCG weekly compute spend ${compute_total:.2f} over ${threshold:.2f} threshold",
            Message=(
                f"Rolling 7-day compute cost ({result['window']}): "
                f"${compute_total:.2f} (EC2 ${ec2_total:.2f} + Bedrock ${bedrock_total:.2f}), "
                f"above the ${threshold:.2f} threshold.\n\n"
                "This checks EC2 + Bedrock only (the two services that can spike from a "
                "left-on instance or a runaway model loop), not the account's total bill, "
                "which the existing monthly AWS Budget already covers.\n\n"
                f"Raw totals by service: {json.dumps(by_service, indent=2)}"
            ),
        )
    return result
