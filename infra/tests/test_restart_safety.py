from pathlib import Path
import unittest


SCRIPT = (Path(__file__).parents[1] / "scripts/restart-yucg.sh").read_text()


class RestartSafetyTests(unittest.TestCase):
    def test_owner_migration_is_opt_in_and_backup_first(self):
        backup = SCRIPT.index('BACKUP="/data/backups/predeploy-')
        gate = SCRIPT.index('DATA_OWNER_MIGRATION_APPROVED}')
        ownership = SCRIPT.index('chown 10001:10001 /data /data/clientreach.db')
        candidate_probe = SCRIPT.index('docker run --rm --network none')
        stop_old = SCRIPT.index('docker rm -f yucg')
        self.assertLess(backup, gate)
        self.assertLess(gate, ownership)
        self.assertLess(ownership, candidate_probe)
        self.assertLess(candidate_probe, stop_old)

    def test_backups_are_excluded_from_owner_migration(self):
        migration = SCRIPT[SCRIPT.index('# One-time migration'):SCRIPT.index('# Probe with the candidate')]
        self.assertNotIn('chown 10001:10001 /data/backups', migration)
        self.assertNotIn('find /data ', migration)


if __name__ == '__main__':
    unittest.main()
