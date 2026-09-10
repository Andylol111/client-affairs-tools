import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('preflight', Path(__file__).parents[1] / 'scripts/check_deployment.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PreflightTests(unittest.TestCase):
    def test_private_instance_contract(self):
        instance = {'State': {'Name': 'running'}, 'MetadataOptions': {'HttpTokens': 'required'}}
        self.assertEqual(module.validate(instance, [{'IpPermissions': []}], [{'Encrypted': True}]), [])
        self.assertTrue(module.validate(instance, [], [{'Encrypted': False}]))
        for rule in ({'IpRanges': [{'CidrIp': '0.0.0.0/0'}]}, {'Ipv6Ranges': [{'CidrIpv6': '::/0'}]}):
            self.assertTrue(module.validate(instance, [{'IpPermissions': [rule]}], [{'Encrypted': True}]))
        self.assertTrue(module.validate({'State': {'Name': 'stopped'}}, [], []))
