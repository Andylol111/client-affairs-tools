import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch
import subprocess
import tempfile

spec = importlib.util.spec_from_file_location('ci_policy', Path(__file__).parents[2] / 'scripts/ci_policy.py')
policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)


class PolicyTests(unittest.TestCase):
    def test_dispatch_uses_target_for_verification_and_first_parent_for_shipping(self):
        for stage, phase, expected in [('intake', 'verify', 'origin/develop'),
                                       ('beta', 'verify', 'origin/feature'),
                                       ('production', 'verify', 'origin/main'),
                                       ('production', 'ship', 'candidate^1')]:
            with self.subTest(stage=stage, phase=phase), patch.object(policy.subprocess, 'check_output', return_value='base\n') as git:
                self.assertEqual(policy.comparison_base(stage, phase, 'workflow_dispatch', 'candidate'), 'base')
                self.assertEqual(git.call_args.args[0][-1], expected)

    def test_native_push_keeps_its_recorded_base(self):
        with patch.object(policy.subprocess, 'check_output') as git:
            self.assertEqual(policy.comparison_base('beta', 'ship', 'push', 'new', 'old'), 'old')
            git.assert_not_called()

    def test_missing_dispatch_history_fails_instead_of_guessing_deploy_scope(self):
        with patch.object(policy.subprocess, 'check_output', side_effect=subprocess.CalledProcessError(1, 'git')):
            with self.assertRaises(subprocess.CalledProcessError):
                policy.comparison_base('production', 'ship', 'workflow_dispatch', 'candidate')

    def test_workflow_only_dispatch_does_not_ship_existing_runtime_files(self):
        # Exercise actual git history: the application exists, but only YAML changed.
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            def git(*args):
                return subprocess.check_output(['git', '-C', directory, *args], text=True, stderr=subprocess.DEVNULL).strip()
            git('init', '-q')
            git('config', 'user.name', 'CI fixture')
            git('config', 'user.email', 'fixture@example.invalid')
            (root / 'backend').mkdir()
            (root / 'backend/main.py').write_text('app = None\n')
            git('add', '.')
            git('commit', '-qm', 'Runtime baseline')
            (root / '.github/workflows').mkdir(parents=True)
            (root / '.github/workflows/production.yml').write_text('name: Production\n')
            git('add', '.')
            git('commit', '-qm', 'Workflow only')
            head = git('rev-parse', 'HEAD')
            with patch.dict(policy.os.environ, {'GIT_DIR': str(root / '.git'), 'GIT_WORK_TREE': directory}):
                base = policy.comparison_base('production', 'ship', 'workflow_dispatch', head)
            scope = policy.classify(git('diff', '--name-only', base, head).splitlines(), 'production', 'ship')
            self.assertFalse(scope['runtime'])
            self.assertFalse(scope['image'])

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
        root = Path(__file__).parents[2].joinpath('.github/workflows')
        names = sorted(path.name for path in root.glob('*.yml'))
        self.assertEqual(names, ['beta.yml', 'intake.yml', 'production.yml'])
        self.assertIn("needs.scope.outputs.security == 'true'", root.joinpath('beta.yml').read_text())

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
        text = Path(__file__).parents[2].joinpath('.github/workflows/beta.yml').read_text()
        self.assertIn('always() && !cancelled()', text)


if __name__ == '__main__':
    unittest.main()
