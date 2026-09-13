import importlib.util
import json
from pathlib import Path
import unittest

INFRA = Path(__file__).parents[1]
spec = importlib.util.spec_from_file_location('preflight', INFRA / 'scripts/check_deployment.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PreflightTests(unittest.TestCase):
    def test_ship_role_can_read_only_the_target_security_metadata(self):
        policy = json.loads((INFRA / 'github/ship-role-policy.proposed.json').read_text())
        actions = {
            action
            for statement in policy['Statement']
            for action in ([statement['Action']] if isinstance(statement['Action'], str) else statement['Action'])
        }
        self.assertTrue({
            'ec2:DescribeInstances',
            'ec2:DescribeSecurityGroups',
            'ec2:DescribeVolumes',
        }.issubset(actions))
        self.assertFalse({
            'ec2:RunInstances',
            'ec2:StartInstances',
            'ec2:StopInstances',
            'ec2:TerminateInstances',
            'iam:PassRole',
        } & actions)

    def test_private_instance_contract(self):
        instance = {'State': {'Name': 'running'}, 'MetadataOptions': {'HttpTokens': 'required'}}
        self.assertEqual(module.validate(instance, [{'IpPermissions': []}], [{'Encrypted': True}]), [])
        self.assertTrue(module.validate(instance, [], [{'Encrypted': False}]))
        for rule in ({'IpRanges': [{'CidrIp': '0.0.0.0/0'}]}, {'Ipv6Ranges': [{'CidrIpv6': '::/0'}]}):
            self.assertTrue(module.validate(instance, [{'IpPermissions': [rule]}], [{'Encrypted': True}]))
        self.assertTrue(module.validate({'State': {'Name': 'stopped'}}, [], []))
