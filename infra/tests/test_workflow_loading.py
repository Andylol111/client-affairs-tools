"""Runner prerequisites that workflow syntax checks cannot establish on their own."""
from pathlib import Path
import json
import re
import unittest

ROOT = Path(__file__).parents[2]


class WorkflowLoadingTests(unittest.TestCase):
    def test_single_maintainer_rules_do_not_require_unavailable_ai_or_peer_approval(self):
        for name in ('feature-ruleset.proposed.json', 'main-ruleset.proposed.json'):
            ruleset = json.loads(ROOT.joinpath('infra/github', name).read_text())
            pull_request = next(rule for rule in ruleset['rules']
                                if rule['type'] == 'pull_request')['parameters']
            checks = next(rule for rule in ruleset['rules']
                          if rule['type'] == 'required_status_checks')['parameters']
            self.assertEqual(pull_request['required_approving_review_count'], 0)
            self.assertFalse(pull_request['require_extra_approval_for_unattributed_changes'])
            self.assertFalse(checks['strict_required_status_checks_policy'])

    def test_exactly_three_repository_workflows_back_four_sidebar_entries(self):
        workflows = sorted(path.name for path in (ROOT / '.github/workflows').glob('*.yml'))
        self.assertEqual(workflows, ['beta.yml', 'intake.yml', 'production.yml'])
        self.assertEqual((ROOT / '.github/workflows/intake.yml').read_text().splitlines()[0],
                         'name: Intake')
        self.assertEqual((ROOT / '.github/workflows/beta.yml').read_text().splitlines()[0],
                         'name: Beta · Develop to Feature')
        self.assertEqual((ROOT / '.github/workflows/production.yml').read_text().splitlines()[0],
                         'name: Production · Feature to Main')

    def test_ship_uses_ephemeral_ecr_helper_instead_of_docker_login(self):
        ship = ROOT.joinpath('.github/actions/ship/action.yml').read_text()
        helper = ROOT.joinpath('infra/scripts/ecr-credentials.sh').read_text()
        self.assertNotIn('docker login', ship)
        self.assertIn('DOCKER_CONFIG="$(mktemp -d)"', helper)
        self.assertIn('"credHelpers"', helper)

    def test_local_actions_are_loaded_after_checkout_in_each_job(self):
        for workflow in (ROOT / '.github/workflows').glob('*.yml'):
            checked_out = False
            job = ''
            for line in workflow.read_text().splitlines():
                if re.fullmatch(r'  [\w-]+:', line):
                    job, checked_out = line.strip(), False
                if line.strip().startswith('- uses: actions/checkout@'):
                    checked_out = True
                if line.strip().startswith('- uses: ./.github/actions/'):
                    self.assertTrue(checked_out, f'{workflow.name}/{job} loads an action before checkout')
                    action = ROOT / line.split('uses: ', 1)[1] / 'action.yml'
                    self.assertTrue(action.is_file(), str(action))

    def test_privileged_promotion_uses_existing_trusted_script(self):
        for workflow in (ROOT / '.github/workflows').glob('*.yml'):
            jobs = re.split(r'^  (?=[\w-]+:\s*$)', workflow.read_text(), flags=re.MULTILINE)
            promote = next(job for job in jobs if job.startswith('promote:'))
            self.assertIn('ref: ${{ github.event.repository.default_branch }}', promote)
            self.assertIn('persist-credentials: false', promote)
            self.assertIn('run: python3 scripts/promote.py', promote)
            # No dependency on a composite that is not present on main at first rollout.
            self.assertNotIn('uses: ./.github/', promote)

    def test_scope_checkout_contains_parent_and_target_history(self):
        for workflow in (ROOT / '.github/workflows').glob('*.yml'):
            scope = workflow.read_text().split('\n  scope:', 1)[1].split('\n  backend:', 1)[0]
            self.assertIn('fetch-depth: 0', scope)


if __name__ == '__main__':
    unittest.main()
