"""Classify changed paths and account for every required check (no cloud access)."""
import argparse
import json
import os
import subprocess


def classify(paths, stage):
    selected = dict.fromkeys(('backend', 'frontend', 'infra', 'image'), False)
    for path in paths:
        if path.startswith('docs/') or ('/' not in path and path.endswith('.md')):
            continue
        if path.startswith('frontend/'):
            selected.update(frontend=True, image=True)
        elif path.startswith('backend/'):
            selected.update(backend=True, image=True)
            if path.startswith(('backend/app/routers/', 'backend/app/models')):
                selected['frontend'] = True
        elif path.startswith(('infra/', 'terraform/')):
            selected['infra'] = True
            if path == 'infra/lib/host_control.py':
                selected['backend'] = True
        else:
            selected = dict.fromkeys(selected, True)
    # Production candidates always prove all boundaries for executable changes.
    if stage == 'production' and any(selected.values()):
        selected = dict.fromkeys(selected, True)
    selected['security'] = True
    # IaC and CI edits may require tests, but never implicitly deploy infrastructure.
    selected['runtime'] = any(p.startswith(('backend/', 'frontend/')) or
                              p in ('docker/app.Dockerfile', '.dockerignore') for p in paths)
    return selected


def check_results(scope, results):
    errors = []
    for name in ('backend', 'frontend', 'infra', 'image', 'security'):
        expected = 'success' if scope[name] else 'skipped'
        actual = results.get(name, {}).get('result', 'missing')
        if actual != expected:
            errors.append(f'{name}: expected {expected}, received {actual}')
    return errors


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('stage', choices=['intake', 'beta', 'production'])
    args = parser.parse_args()
    base = os.environ.get('BASE_SHA', '')
    head = os.environ['GITHUB_SHA']
    if not base or set(base) == {'0'}:
        paths = subprocess.check_output(['git', 'ls-files', '-z']).decode().split('\0')
    else:
        paths = subprocess.check_output(['git', 'diff', '--name-only', '-z', base, head]).decode().split('\0')
    scope = classify([p for p in paths if p], args.stage)
    with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
        for name, enabled in scope.items():
            output.write(f'{name}={str(enabled).lower()}\n')
        output.write('scope=' + json.dumps(scope) + '\n')
    with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as summary:
        summary.write(f'## {args.stage.title()} verification\n\n')
        summary.write('| Check | Decision |\n| --- | --- |\n')
        for name, enabled in scope.items():
            summary.write(f'| {name} | {"Required" if enabled else "Not affected by this diff"} |\n')
        summary.write('\nTerraform apply is a separate, approved saved-plan operation.\n')
