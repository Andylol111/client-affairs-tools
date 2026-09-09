from pathlib import Path
import os
import sqlite3
import subprocess
import tempfile
import unittest

class BackupUploadTests(unittest.TestCase):
    def test_opt_in_and_manifest_last(self):
        with tempfile.TemporaryDirectory() as root:
            root=Path(root)
            source=root/'source.db'
            with sqlite3.connect(source) as db:
                db.execute('CREATE TABLE members(id INTEGER)')
                db.execute('INSERT INTO members VALUES (7)')
            (root/'aws').write_text('#!/bin/sh\nprintf "%s\\n" "$*" >> "$CALL_LOG"\n')
            (root/'aws').chmod(0o755)
            log=root/'calls'
            env={**os.environ,'PATH':str(root)+os.pathsep+os.environ['PATH'],'CALL_LOG':str(log),
                 'BACKUP_BUCKET':'test-private-backups','BACKUP_UPLOAD_APPROVED':'false'}
            script=Path(__file__).parents[1]/'scripts'/'backup-to-s3.sh'
            result=subprocess.run(['bash',str(script),str(source)],env=env,capture_output=True)
            self.assertNotEqual(result.returncode,0)
            self.assertFalse(log.exists())
            env['BACKUP_UPLOAD_APPROVED']='true'
            missing_bucket={k:v for k,v in env.items() if k != 'BACKUP_BUCKET'}
            result=subprocess.run(['bash',str(script),str(source)],env=missing_bucket,capture_output=True)
            self.assertNotEqual(result.returncode,0)
            self.assertFalse(log.exists())
            subprocess.run(['bash',str(script),str(source)],env=env,check=True)
            calls=log.read_text().splitlines()
            self.assertEqual(len(calls),3)
            self.assertIn('/manifest.json',calls[-1])
            self.assertTrue(all('--sse AES256' in c for c in calls))
            with sqlite3.connect(source) as db:
                self.assertEqual(db.execute('SELECT id FROM members').fetchone()[0],7)

if __name__=='__main__':unittest.main()
