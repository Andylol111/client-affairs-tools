from pathlib import Path
import os
import subprocess
import tempfile
import unittest

class StaticPublishTests(unittest.TestCase):
    def test_assets_before_entry_and_no_delete(self):
        with tempfile.TemporaryDirectory() as root:
            root=Path(root)
            (root/'assets').mkdir()
            (root/'index.html').write_text('<html></html>')
            (root/'aws').write_text('#!/bin/sh\nprintf "%s\\n" "$*" >> "$CALL_LOG"\n[ "${FAIL_UPLOAD:-false}" != true ]\n')
            (root/'aws').chmod(0o755)
            log=root/'calls'
            env={**os.environ,'PATH':str(root)+os.pathsep+os.environ['PATH'],'CALL_LOG':str(log),
                 'STATIC_BUCKET':'test-private-static','STATIC_CUTOVER_APPROVED':'true'}
            script=Path(__file__).parents[1]/'scripts'/'publish-static.sh'
            subprocess.run(['bash',str(script),str(root)],env=env,check=True)
            calls=log.read_text().splitlines()
            self.assertEqual(len(calls),3)
            self.assertIn('/assets/',calls[0])
            self.assertIn('/index.html',calls[-1])
            self.assertIn('no-cache',calls[-1])
            self.assertFalse(any('--delete' in c or 'invalidation' in c for c in calls))
            env['STATIC_CUTOVER_APPROVED']='false'
            result=subprocess.run(['bash',str(script),str(root)],env=env)
            self.assertNotEqual(result.returncode,0)
            self.assertEqual(log.read_text().splitlines(),calls)
            env['STATIC_CUTOVER_APPROVED']='true'
            env['FAIL_UPLOAD']='true'
            result=subprocess.run(['bash',str(script),str(root)],env=env)
            self.assertNotEqual(result.returncode,0)
            self.assertEqual(len(log.read_text().splitlines()),len(calls)+1)

if __name__=='__main__':unittest.main()
