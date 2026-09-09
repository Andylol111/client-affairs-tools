import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('handoff', Path(__file__).parents[1] / 'scripts/check_handoff_plan.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class HandoffPlanTests(unittest.TestCase):
    def plan(self, actions, kind='aws_s3_bucket'):
        return {'format_version': '1.2', 'resource_changes': [{'address': 'example', 'type': kind, 'change': {'actions': actions}}]}

    def test_storage_creation_is_reviewable(self):
        self.assertEqual(module.violations(self.plan(['create'])), [])

    def test_replacement_and_compute_mutations_block(self):
        for actions, kind in [(['delete'], 'aws_s3_bucket'), (['create', 'delete'], 'aws_s3_bucket'), (['update'], 'aws_instance'), (['create'], 'aws_ebs_volume')]:
            with self.subTest(actions=actions, kind=kind):
                self.assertTrue(module.violations(self.plan(actions, kind)))

    def test_incomplete_unknown_and_drift_block(self):
        for change in [{'complete': False}, {'errored': True}, {'format_version': '2.0'}, {'resource_drift': [{'address': 'live', 'change': {'actions': ['update']}}]}]:
            self.assertTrue(module.violations({**self.plan(['no-op']), **change}))
        self.assertTrue(module.violations(self.plan(['forget'])))
