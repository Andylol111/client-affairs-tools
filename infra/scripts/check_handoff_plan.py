"""Review a local Terraform JSON plan; never contacts AWS or applies changes.

Usage: terraform show -json saved.tfplan > /private/path/plan.json
       python3 infra/scripts/check_handoff_plan.py /private/path/plan.json
Plan JSON can contain secrets. Only resource addresses/actions are printed.
"""
import json
import re
import sys
from pathlib import Path


APPROVED_TYPES = {
    'aws_s3_bucket', 'aws_s3_bucket_public_access_block', 'aws_s3_bucket_versioning',
    'aws_s3_bucket_server_side_encryption_configuration', 'aws_s3_bucket_policy',
    'aws_s3_bucket_cors_configuration', 'aws_s3_bucket_lifecycle_configuration',
    'aws_iam_role_policy', 'aws_cloudfront_distribution',
    'aws_cloudfront_origin_access_control', 'aws_cloudfront_function',
    'aws_cloudfront_cache_policy',
}


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
        if actions in (['create'], ['update']):
            after = item.get('change', {}).get('after') or {}
            kind = item.get('type', '')
            if kind not in APPROVED_TYPES:
                errors.append(f'{address}: resource type is outside approved storage/CDN handoff')
            if kind == 'aws_s3_bucket_server_side_encryption_configuration':
                rules = after.get('rule') or []
                if not rules or any(
                    not rule.get('apply_server_side_encryption_by_default') or
                    any(default.get('sse_algorithm') not in {'AES256', 'aws:kms', 'aws:kms:dsse'}
                        for default in rule['apply_server_side_encryption_by_default'])
                    for rule in rules
                ):
                    errors.append(f'{address}: known AES256 or KMS encryption is required')
            if kind == 'aws_s3_bucket_cors_configuration':
                rules = after.get('cors_rule') or []
                if not rules or any(
                    not rule.get('allowed_origins') or
                    any(not isinstance(origin, str) or not re.fullmatch(r'https://[A-Za-z0-9.-]+(?::[0-9]+)?', origin)
                        for origin in rule['allowed_origins']) or
                    not rule.get('allowed_methods') or
                    not set(rule['allowed_methods']).issubset({'GET', 'PUT', 'HEAD'}) or
                    not set(rule.get('allowed_headers') or []).issubset({'Content-Type', 'If-None-Match'})
                    for rule in rules
                ):
                    errors.append(f'{address}: CORS requires exact HTTPS origins and approved transfer methods/headers')

            if kind == 'aws_s3_bucket_public_access_block':
                required = ('block_public_acls', 'block_public_policy', 'ignore_public_acls', 'restrict_public_buckets')
                if any(after.get(key) is not True for key in required):
                    errors.append(f'{address}: all public access blocks must be enabled and known')
            if kind == 'aws_s3_bucket_versioning':
                if not after.get('versioning_configuration') or after['versioning_configuration'][0].get('status') != 'Enabled':
                    errors.append(f'{address}: versioning cannot be disabled')
            if kind == 'aws_s3_bucket' and after.get('force_destroy') is not False:
                errors.append(f'{address}: force_destroy must be false')
            if kind in {'aws_s3_bucket_policy', 'aws_iam_role_policy'}:
                try:
                    statements = json.loads(after.get('policy', ''))['Statement']
                    if isinstance(statements, dict):
                        statements = [statements]
                    for statement in statements:
                        if statement.get('Effect') != 'Allow':
                            continue
                        action = statement.get('Action', [])
                        resource = statement.get('Resource', [])
                        action = [action] if isinstance(action, str) else action
                        resource = [resource] if isinstance(resource, str) else resource
                        principal = statement.get('Principal')
                        if not action or not resource or any('*' in a for a in action) or '*' in resource or principal == '*' or (isinstance(principal, dict) and '*' in str(principal)):
                            errors.append(f'{address}: broad Allow policy requires a separate review')
                except (ValueError, KeyError, TypeError):
                    errors.append(f'{address}: policy must be fully known and inspectable')
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
