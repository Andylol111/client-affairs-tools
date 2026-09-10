import importlib.util
from pathlib import Path
import sqlite3
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('backup', Path(__file__).parents[1] / 'scripts' / 'backup_sqlite.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class BackupTests(unittest.TestCase):
    def test_wal_restore_preserves_committed_rows(self):
        with tempfile.TemporaryDirectory() as root:
            source = Path(root) / 'source.db'
            db = sqlite3.connect(source)
            db.execute('PRAGMA journal_mode=WAL')
            db.execute('PRAGMA wal_autocheckpoint=0')
            db.execute('CREATE TABLE members(id INTEGER PRIMARY KEY,email TEXT)')
            db.executemany('INSERT INTO members(email) VALUES (?)', [('one@yale.edu',), ('two@yale.edu',)])
            db.commit()
            self.assertTrue(Path(str(source)+'-wal').exists())
            target = Path(root) / 'backup.db'
            result = module.backup(source,target)
            with sqlite3.connect(target) as restored:
                self.assertEqual(restored.execute('SELECT email FROM members ORDER BY id').fetchall(), [('one@yale.edu',),('two@yale.edu',)])
            self.assertEqual(module.rehearse(source)['row_counts']['members'],2)
            self.assertEqual(len(result['sha256']),64)
            with self.assertRaises(ValueError): module.backup(source,target)
            db.close()

if __name__ == '__main__': unittest.main()
