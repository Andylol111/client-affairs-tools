"""Read-only AWS deployment preflight. Does not send SSM commands or invoke models."""
import json
import os
import subprocess


def aws(*args):
    return json.loads(subprocess.check_output(['aws', *args, '--output', 'json'], text=True))


def validate(instance, groups, volumes):
    problems = []
    if instance.get('State', {}).get('Name') != 'running':
        problems.append('Target instance is not running')
    if instance.get('MetadataOptions', {}).get('HttpTokens') != 'required':
        problems.append('IMDSv2 is required')
    for group in groups:
        for rule in group.get('IpPermissions', []):
            if any(ip.get('CidrIp') == '0.0.0.0/0' for ip in rule.get('IpRanges', [])) or any(ip.get('CidrIpv6') == '::/0' for ip in rule.get('Ipv6Ranges', [])):
                problems.append('Instance security group permits direct public ingress')
    if not volumes or any(v.get('Encrypted') is not True for v in volumes):
        problems.append('All instance volumes must be encrypted')
    return problems


if __name__ == '__main__':
    instance_id = os.environ['AWS_INSTANCE_ID']
    result = aws('ec2', 'describe-instances', '--instance-ids', instance_id)
    instance = result['Reservations'][0]['Instances'][0]
    groups = aws('ec2', 'describe-security-groups', '--group-ids',
                 *[g['GroupId'] for g in instance['SecurityGroups']])['SecurityGroups']
    volumes = aws('ec2', 'describe-volumes', '--volume-ids',
                  *[b['Ebs']['VolumeId'] for b in instance['BlockDeviceMappings'] if 'Ebs' in b])['Volumes']
    problems = validate(instance, groups, volumes)
    if problems:
        raise SystemExit('; '.join(problems))
    print('AWS target is running, requires IMDSv2, has encrypted volumes and no direct public ingress.')
