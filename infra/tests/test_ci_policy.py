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
            self.assertTrue(all(scope[k] for k in ('backend', 'frontend', 'infra', 'security')))
            self.assertFalse(scope['image'])
            self.assertFalse(scope['runtime'])

    def test_intake_never_builds_image(self):
        scope = policy.classify(['frontend/src/App.tsx'], 'intake')
        self.assertTrue(scope['frontend'] and scope['security'] and scope['runtime'])
        self.assertFalse(scope['image'])

    def test_ship_phase_only_rebuilds_the_image(self):
        scope = policy.classify(['frontend/src/App.tsx'], 'production', 'ship')
        self.assertTrue(scope['image'] and scope['runtime'])
        self.assertFalse(any(scope[k] for k in ('backend', 'frontend', 'infra', 'security')))

    def test_intake_push_does_not_rerun_verify(self):
        text = Path(__file__).parents[2].joinpath('.github/workflows/intake.yml').read_text()
        self.assertIn('mode=promote', text)
        self.assertIn("needs.route.outputs.mode == 'tests'", text)
        self.assertIn("needs.required-checks.result == 'success'", text)

    def test_promote_runs_when_an_optional_job_is_skipped(self):
        root = Path(__file__).parents[2].joinpath('.github/workflows')
        for name in ('intake.yml', 'beta.yml', 'production.yml'):
            text = root.joinpath(name).read_text()
            self.assertNotIn('if: success()', text, name)

    def test_security_is_skippable_on_ship(self):
        text = Path(__file__).parents[2].joinpath('.github/workflows/verify.yml').read_text()
        self.assertIn('phase:', text)
        self.assertIn("needs.scope.outputs.security == 'true'", text)

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

    def test_gate_does_not_fail_a_superseded_run(self):
        text = Path(__file__).parents[2].joinpath('.github/workflows/verify.yml').read_text()
        self.assertIn('always() && !cancelled()', text)


if __name__ == '__main__':
    unittest.main()
