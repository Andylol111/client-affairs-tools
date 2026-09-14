from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[2]


class BootstrapContractTests(unittest.TestCase):
    def test_non_root_data_mount_and_environment_are_explicit(self):
        script = (ROOT / 'infra/lib/user-data.sh').read_text()
        stack = (ROOT / 'infra/lib/yucg-outreach-stack.ts').read_text()
        self.assertIn('chown 10001:10001 /data', script)
        self.assertIn('chmod 0750 /data', script)
        self.assertIn('setpriv --reuid 10001 --regid 10001 --clear-groups test -r', script)
        self.assertIn('migrate only clientreach.db, clientreach.db-wal, and clientreach.db-shm', script)
        self.assertIn('YUCG_APP_ENV must be beta or production', script)
        self.assertIn('echo "APP_ENV=$YUCG_APP_ENV"', script)
        self.assertIn('echo "EMAIL_DELIVERY_ENABLED=$EMAIL_DELIVERY_ENABLED"', script)
        self.assertIn('envName === "dev" || envName === "prod"', stack)
        self.assertIn('Unsupported environment', stack)
        self.assertIn('`export YUCG_APP_ENV=${appEnv}`', stack)

    def test_bedrock_runtime_is_haiku_only_and_bootstrap_matches_iam(self):
        script = (ROOT / 'infra/lib/user-data.sh').read_text()
        stack = (ROOT / 'infra/lib/yucg-outreach-stack.ts').read_text()
        model = 'us.anthropic.claude-haiku-4-5-20251001-v1:0'
        self.assertIn(f'BEDROCK_MODEL_ID={model}', script)
        self.assertIn(f'BEDROCK_RANK_MODEL_ID={model}', script)
        self.assertIn(f'BEDROCK_ALLOWED_MODEL_IDS={model}', script)
        self.assertIn(f'["{model}"]', stack)
        self.assertNotIn('claude-opus', stack.lower())
        self.assertNotIn('claude-sonnet', stack.lower())


if __name__ == '__main__':
    unittest.main()
