from pathlib import Path
import unittest


SCRIPT = (Path(__file__).parents[1] / "scripts/restart-yucg.sh").read_text()


class RestartSafetyTests(unittest.TestCase):
    def test_owner_migration_is_opt_in_and_backup_first(self):
        self.assertLess(SCRIPT.index('umask 0077'), SCRIPT.index('BACKUP="/data/backups/predeploy-'))
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

    def test_predeploy_snapshots_are_pruned_but_never_before_the_release_is_healthy(self):
        """Each release snapshots the whole database next to it. That was 1.3 MB
        until the public company register landed and made it 70 MB, so an
        unpruned directory fills the 8 GB data volume in days and the next write
        fails. Prune to a handful, and only after the health probe, so a failed
        release never destroys the copy it may need to roll back to."""
        prune = SCRIPT.index('ls -1t /data/backups/predeploy-')
        healthy = SCRIPT.index('# Probe with the candidate')
        self.assertLess(healthy, prune, 'pruning must follow the health probe')
        self.assertIn('tail -n +6', SCRIPT)
        # The live database and the nightly off-box copy are never touched here.
        prune_line = SCRIPT[prune:SCRIPT.index('\n', prune)]
        self.assertNotIn('clientreach.db', prune_line)
        self.assertIn('predeploy-', prune_line)


if __name__ == '__main__':
    unittest.main()
