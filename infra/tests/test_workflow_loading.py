"""Runner prerequisites that workflow syntax checks cannot establish on their own."""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).parents[2]


class WorkflowLoadingTests(unittest.TestCase):
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
