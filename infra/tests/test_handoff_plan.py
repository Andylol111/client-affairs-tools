import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('handoff', Path(__file__).parents[1] / 'scripts/check_handoff_plan.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class HandoffPlanTests(unittest.TestCase):
    def plan(self, actions, kind='aws_s3_bucket'):
        return {'format_version': '1.2', 'resource_changes': [{'address': 'example', 'type': kind, 'change': {'actions': actions, 'after': {'force_destroy': False}}}]}

    def test_storage_creation_is_reviewable(self):
        self.assertEqual(module.violations(self.plan(['create'])), [])

    def test_public_or_unknown_storage_and_iam_are_blocked(self):
        for kind, after in [('aws_s3_bucket_public_access_block', {'block_public_acls': True}),
                            ('aws_s3_bucket_versioning', {'versioning_configuration': [{'status': 'Suspended'}]}),
                            ('aws_s3_bucket', {'force_destroy': True}),
                            ('aws_iam_role_policy', {}),
                            ('aws_iam_role_policy', {'policy': '{"Statement":[{"Effect":"Allow","Action":"*","Resource":"*"}]}'}),
                            ('aws_s3_bucket_policy', {'policy': '{"Statement":[{"Effect":"Allow","Action":"s3:GetObject","Resource":"arn:aws:s3:::club/*","Principal":"*"}]}'} )]:
            plan = self.plan(['update'], kind)
            plan['resource_changes'][0]['change']['after'] = after
            self.assertTrue(module.violations(plan), kind)

    def test_replacement_and_compute_mutations_block(self):
        for actions, kind in [(['delete'], 'aws_s3_bucket'), (['create', 'delete'], 'aws_s3_bucket'), (['update'], 'aws_instance'), (['create'], 'aws_ebs_volume')]:
            with self.subTest(actions=actions, kind=kind):
                self.assertTrue(module.violations(self.plan(actions, kind)))

    def test_incomplete_unknown_and_drift_block(self):
        for change in [{'complete': False}, {'errored': True}, {'format_version': '2.0'}, {'resource_drift': [{'address': 'live', 'change': {'actions': ['update']}}]}]:
            self.assertTrue(module.violations({**self.plan(['no-op']), **change}))
        self.assertTrue(module.violations(self.plan(['forget'])))
