import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('ci_policy', Path(__file__).parents[2] / 'scripts/ci_policy.py')
policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)


class PolicyTests(unittest.TestCase):
    def test_docs_keep_security_without_build(self):
        scope = policy.classify(['docs/readme.md'], 'intake')
        self.assertTrue(scope['security'])
        self.assertFalse(scope['image'])
        self.assertFalse(scope['runtime'])

    def test_unknown_and_workflow_changes_run_all_checks(self):
        for path in ['new-entrypoint.sh', '.github/workflows/intake.yml']:
            scope = policy.classify([path], 'intake')
            self.assertTrue(all(scope[k] for k in ('backend', 'frontend', 'infra', 'image', 'security')))
            self.assertFalse(scope['runtime'])

    def test_api_contract_checks_frontend(self):
        self.assertTrue(policy.classify(['backend/app/routers/emails.py'], 'intake')['frontend'])

    def test_application_markdown_cannot_skip_build(self):
        for path in ('backend/app/prompts/draft.md', 'frontend/src/help.md'):
            scope = policy.classify([path], 'beta')
            self.assertTrue(scope['image'])
            self.assertTrue(scope['runtime'])

    def test_production_patch_has_full_gate(self):
        self.assertTrue(all(policy.classify(['frontend/src/App.tsx'], 'production').values()))

    def test_skipped_required_job_is_failure(self):
        scope = policy.classify(['backend/app/services/llm.py'], 'beta')
        results = {k: {'result': 'success' if v else 'skipped'} for k, v in scope.items()}
        self.assertEqual(policy.check_results(scope, results), [])
        for result in ('skipped', 'cancelled', 'failure', 'missing'):
            results['backend'] = {'result': result}
            self.assertTrue(policy.check_results(scope, results))


if __name__ == '__main__':
    unittest.main()
