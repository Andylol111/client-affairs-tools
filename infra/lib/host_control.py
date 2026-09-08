"""Lambda: start/stop/status the outreach EC2 box. Invoked from CloudShell or EventBridge."""
from __future__ import annotations

import json
import os

import boto3

_EC2 = None


def _client():
    global _EC2
    if _EC2 is None:
        _EC2 = boto3.client("ec2")
    return _EC2


def handle(event, _context=None) -> dict:
    iid = os.environ["INSTANCE_ID"]
    event = event or {}
    if isinstance(event, str):
        event = json.loads(event)
    if event.get("NewStateValue") == "ALARM":
        action = "stop"
    else:
        action = str(
            event.get("action")
            or (event.get("detail") or {}).get("action")
            or "status"
        ).lower()
    ec2 = _client()
    if action == "stop":
        ec2.stop_instances(InstanceIds=[iid])
    elif action == "start":
        ec2.start_instances(InstanceIds=[iid])
    elif action != "status":
        return {"ok": False, "error": f"unknown action {action}"}
    st = ec2.describe_instances(InstanceIds=[iid])
    state = st["Reservations"][0]["Instances"][0]["State"]["Name"]
    return {"ok": True, "action": action, "state": state}


def handler(event, context):
    return handle(event, context)
