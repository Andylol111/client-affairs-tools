"""HostControl Lambda: alarm payload means stop. From infra/: python3 -c is via backend path."""
from __future__ import annotations

import sys
from pathlib import Path
INFRA = Path(__file__).resolve().parents[2] / "infra" / "lib"
sys.path.insert(0, str(INFRA))

import host_control  # noqa: E402


class _FakeEc2:
    def __init__(self) -> None:
        self.stopped: list[str] = []
        self.started: list[str] = []

    def stop_instances(self, InstanceIds):  # noqa: N803
        self.stopped.extend(InstanceIds)

    def start_instances(self, InstanceIds):  # noqa: N803
        self.started.extend(InstanceIds)

    def describe_instances(self, InstanceIds):  # noqa: N803
        state = "stopped" if self.stopped else "running"
        return {"Reservations": [{"Instances": [{"State": {"Name": state}}]}]}


def _run(event: dict) -> dict:
    fake = _FakeEc2()
    host_control._EC2 = fake
    import os

    os.environ["INSTANCE_ID"] = "i-test"
    out = host_control.handle(event)
    out["_fake"] = fake
    return out


def test_alarm_stops() -> None:
    out = _run({"NewStateValue": "ALARM", "AlarmName": "IdleCpu"})
    assert out["ok"] and out["action"] == "stop"
    assert out["_fake"].stopped == ["i-test"]


def test_explicit_start() -> None:
    out = _run({"action": "start"})
    assert out["ok"] and out["action"] == "start"
    assert out["_fake"].started == ["i-test"]


def test_status_default() -> None:
    out = _run({})
    assert out["ok"] and out["action"] == "status"
    assert out["_fake"].stopped == [] and out["_fake"].started == []


if __name__ == "__main__":
    test_alarm_stops()
    test_explicit_start()
    test_status_default()
    print("ok")
