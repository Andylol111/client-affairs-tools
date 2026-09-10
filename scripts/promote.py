"""Trusted workflow_run controller. Reads GitHub metadata; never executes PR code.

A repository GitHub App is optional. The default identity is GITHUB_TOKEN, which
cannot start workflows from the pull_request or push events it creates, so this
controller dispatches the next stage (Intake, Beta, Production) after a merge
or after opening a promotion PR. Repository rules stay authoritative; this
controller never uses an admin bypass.
"""
import json
import os
import subprocess
import sys

STAGE_FOR_BASE = {'develop': 'Intake', 'feature': 'Beta', 'main': 'Production'}
WORKFLOW_FOR_BRANCH = {'develop': 'intake.yml', 'feature': 'beta.yml', 'main': 'production.yml'}
PROMOTION_EDGES = {('feature', 'develop'), ('main', 'feature')}


def api(path, method='GET', payload=None):
    args = ['gh', 'api', path]
    if method != 'GET':
        args += ['--method', method]
    if payload is not None:
        args += ['--input', '-']
    result = subprocess.run(args, input=json.dumps(payload) if payload is not None else None,
                            text=True, capture_output=True, check=True)
    return json.loads(result.stdout) if result.stdout else None


def held(pr):
    return pr.get('draft') or bool({'hold', 'do-not-merge', 'release:hold'} &
                                  {label['name'] for label in pr.get('labels', [])})


def latest_reviews_block(reviews):
    latest = {}
    for review in sorted(reviews, key=lambda r: r.get('submitted_at') or ''):
        if review['state'] in ('APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'):
            latest[review['user']['login']] = review['state']
    return 'CHANGES_REQUESTED' in latest.values()


def dependency_files_allowed(files):
    allowed = {'frontend/package.json', 'frontend/package-lock.json',
               'infra/package.json', 'infra/package-lock.json', 'terraform/.terraform.lock.hcl'}
    return bool(files) and all(item['filename'] in allowed for item in files)


def dispatch_workflow(repo, workflow, ref):
    """Start the next stage when GITHUB_TOKEN cannot trigger it by event."""
    if os.environ.get('PROMOTION_DISPATCH') != '1':
        return
    api(f'repos/{repo}/actions/workflows/{workflow}/dispatches', 'POST', {'ref': ref})


def merge_now(repo, number, sha, base):
    subprocess.run(['gh', 'pr', 'merge', str(number), '--repo', repo,
                    '--merge', '--match-head-commit', sha], check=True)
    workflow = WORKFLOW_FOR_BRANCH.get(base)
    if workflow:
        dispatch_workflow(repo, workflow, base)


def pull_requests_for(run, repo):
    listed = list(run.get('pull_requests') or [])
    if listed:
        return listed
    if run.get('event') != 'workflow_dispatch':
        return []
    sha = run['head_sha']
    open_prs = api(f'repos/{repo}/pulls?state=open&per_page=100') or []
    return [{'number': item['number']} for item in open_prs if item.get('head', {}).get('sha') == sha]


def synchronize(repo, source):
    """Carry protected-branch merge history back through a normal Intake PR."""
    prefix = f'repos/{repo}'
    sha = api(f'{prefix}/branches/{source}')['commit']['sha']
    comparison = api(f'{prefix}/compare/develop...{source}')
    if comparison['ahead_by'] == 0:
        return
    branch = f'sync/{source}-{sha[:12]}'
    prior = api(f'{prefix}/pulls?state=all&base=develop&head={repo.split("/")[0]}:{branch}')
    if prior:
        return  # A rejected synchronization is a hold, never an automatic reopen.
    refs = api(f'{prefix}/git/matching-refs/heads/{branch}')
    if not refs:
        api(f'{prefix}/git/refs', 'POST', {'ref': f'refs/heads/{branch}', 'sha': sha})
    elif len(refs) != 1 or refs[0]['object']['sha'] != sha:
        raise RuntimeError('Synchronization ref differs from trusted branch')
    api(f'{prefix}/pulls', 'POST', {
        'head': branch, 'base': 'develop', 'title': f'Synchronize {source} history into develop',
        'body': f'Carries trusted `{source}` revision `{sha}` back through Intake. '
                'Required checks and human holds apply. This PR does not deploy.'})
    dispatch_workflow(repo, 'intake.yml', branch)


def process_pull_requests(run, repo):
    prefix = f'repos/{repo}'
    for candidate in pull_requests_for(run, repo):
        pr = api(f"{prefix}/pulls/{candidate['number']}")
        if pr['state'] != 'open' or held(pr) or pr['head']['repo']['full_name'] != repo:
            continue
        if pr['head']['sha'] != run['head_sha']:
            continue  # Never merge newer, unchecked code using an older run.
        base, head = pr['base']['ref'], pr['head']['ref']
        if run['name'] != STAGE_FOR_BASE.get(base):
            continue
        promotion = (base, head) in PROMOTION_EDGES
        dependency = base == 'develop' and pr['user']['login'] == 'dependabot[bot]'
        requested = base == 'develop' and 'automerge' in {label['name'] for label in pr.get('labels', [])}
        sync_source = head.split('/')[1].split('-')[0] if head.startswith('sync/') else ''
        sync = base == 'develop' and sync_source in {'main', 'feature'} and pr['head']['sha'] == api(f'{prefix}/branches/{sync_source}')['commit']['sha']
        if not promotion and not dependency and not sync and not requested:
            continue
        reviews = api(f"{prefix}/pulls/{pr['number']}/reviews?per_page=100")
        if len(reviews) == 100 or latest_reviews_block(reviews):
            continue  # Conservative when pagination or human rejection needs attention.
        if dependency:
            files = api(f"{prefix}/pulls/{pr['number']}/files?per_page=100")
            if len(files) == 100 or not dependency_files_allowed(files):
                continue
        current = api(f"{prefix}/pulls/{pr['number']}")
        if current['state'] != 'open' or held(current) or current['head']['sha'] != pr['head']['sha']:
            continue
        merge_now(repo, pr['number'], pr['head']['sha'], base)


def process_branch(run, repo):
    prefix = f'repos/{repo}'
    source = run['head_branch']
    if source not in {'develop', 'feature', 'main'}:
        return
    if api(f'{prefix}/branches/{source}')['commit']['sha'] != run['head_sha']:
        return
    if source == 'main' and run['name'] == 'Production':
        synchronize(repo, 'main')
        return
    target = {'develop': 'feature', 'feature': 'main'}.get(source)
    if not target or run['name'] != STAGE_FOR_BASE[source]:
        return
    comparison = api(f'{prefix}/compare/{target}...{source}')
    if comparison['behind_by']:
        synchronize(repo, target)
        return
    if not comparison['files']:
        return
    existing = api(f'{prefix}/pulls?state=all&base={target}&head={repo.split("/")[0]}:{source}&per_page=100')
    if any(p['state'] == 'open' for p in existing):
        return
    if any(p['state'] == 'closed' and not p.get('merged_at') and p['head']['sha'] == run['head_sha'] for p in existing):
        return
    if len(existing) == 100:
        raise RuntimeError('Promotion history needs review before continuing')
    api(f'{prefix}/pulls', 'POST', {
        'head': source, 'base': target,
        'title': f'Promote verified {source} to {target}',
        'body': f'Candidate `{run["head_sha"]}` passed [{run["name"]}]({run["html_url"]}).\n\n'
                'The next stage must pass its own required checks. Add `release:hold`, request changes, '
                'or close this PR to stop this candidate. Infrastructure apply uses a separate reviewed saved plan.\n\n'
                'Cost: application promotion adds no resources; infrastructure cost changes require their own plan.'})
    dispatch_workflow(repo, WORKFLOW_FOR_BRANCH[target], source)


def process(event, repo):
    run = event['workflow_run']
    if run['head_repository']['full_name'] != repo or run['conclusion'] != 'success':
        return
    if run['name'] not in {'Intake', 'Beta', 'Production'}:
        raise RuntimeError('Unexpected workflow')
    if run['event'] == 'pull_request':
        process_pull_requests(run, repo)
        return
    if run['event'] == 'workflow_dispatch':
        process_pull_requests(run, repo)
        process_branch(run, repo)
        return
    if run['event'] != 'push':
        return
    process_branch(run, repo)


if __name__ == '__main__':
    try:
        with open(os.environ['GITHUB_EVENT_PATH']) as event_file:
            process(json.load(event_file), os.environ['GITHUB_REPOSITORY'])
    except subprocess.CalledProcessError as error:
        print(error.stderr or 'GitHub rejected the automation operation', file=sys.stderr)
        raise SystemExit(1)
