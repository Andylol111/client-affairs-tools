"""Review a local Terraform JSON plan; never contacts AWS or applies changes.

Usage: terraform show -json saved.tfplan > /private/path/plan.json
       python3 infra/scripts/check_handoff_plan.py /private/path/plan.json
Plan JSON can contain secrets. Only resource addresses/actions are printed.
"""
import json
import sys
from pathlib import Path


def violations(plan):
    errors = []
    if plan.get('errored') or plan.get('complete') is False:
        errors.append('Plan is errored or incomplete')
    if not str(plan.get('format_version', '')).startswith('1.'):
        errors.append('Unsupported or missing plan format')
    for item in plan.get('resource_changes', []):
        actions = item.get('change', {}).get('actions', [])
        address = item.get('address', '<unknown>')
        if not actions or any(a not in {'no-op', 'read', 'create', 'update', 'delete'} for a in actions):
            errors.append(f'{address}: unsupported actions')
        if 'delete' in actions:
            errors.append(f'{address}: deletion/replacement requires separate recovery review')
        if item.get('type') in {'aws_instance', 'aws_ebs_volume', 'aws_volume_attachment', 'aws_db_instance'} and actions != ['no-op'] and actions != ['read']:
            errors.append(f'{address}: existing compute/database ownership is outside this handoff')
    for item in plan.get('resource_drift', []):
        if item.get('change', {}).get('actions') != ['no-op']:
            errors.append(f"{item.get('address', '<unknown>')}: observed drift requires review")
    return errors


if __name__ == '__main__':
    problems = violations(json.loads(Path(sys.argv[1]).read_text()))
    for problem in problems:
        print(problem)
    if problems:
        sys.exit(1)
    print('No prohibited handoff actions detected. Human review of identity, ownership, IAM, routing and cost is still required; this does not approve apply.')
