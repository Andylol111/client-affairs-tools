import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as iam from "aws-cdk-lib/aws-iam";

export interface YucgGithubOidcStackProps extends cdk.StackProps {
  envName: string;
  githubOwner: string;
  githubRepo: string;
}

/**
 * IAM role for GitHub Actions ship on main. CloudShell deploys this stack
 * (no instance replace). No long-lived GitHub secrets.
 */
export class YucgGithubOidcStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: YucgGithubOidcStackProps) {
    super(scope, id, props);
    const { envName, githubOwner, githubRepo } = props;
    const repo = `${githubOwner}/${githubRepo}`;

    const provider = new iam.OpenIdConnectProvider(this, "GitHub", {
      url: "https://token.actions.githubusercontent.com",
      clientIds: ["sts.amazonaws.com"],
    });

    const role = new iam.Role(this, "Ship", {
      roleName: `yucg-github-ship-${envName}`,
      description: "GitHub Actions image push + SSM restart on main (OIDC)",
      assumedBy: new iam.FederatedPrincipal(
        provider.openIdConnectProviderArn,
        {
          StringEquals: {
            "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          },
          StringLike: {
            "token.actions.githubusercontent.com:sub": `repo:${repo}:ref:refs/heads/main`,
          },
        },
        "sts:AssumeRoleWithWebIdentity",
      ),
    });

    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["sts:AssumeRole"],
        resources: [
          `arn:aws:iam::${this.account}:role/cdk-hnb659fds-*-role-${this.account}-${this.region}`,
        ],
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "cloudformation:*",
          "ssm:GetParameter",
          "ssm:GetParameters",
          "ssm:SendCommand",
          "ssm:GetCommandInvocation",
          "ssm:ListCommands",
          "ssm:ListCommandInvocations",
          "ecr:*",
          "s3:*",
        ],
        resources: ["*"],
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "iam:PassRole",
          "iam:GetRole",
          "iam:CreateRole",
          "iam:AttachRolePolicy",
          "iam:PutRolePolicy",
        ],
        resources: ["*"],
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "ec2:*",
          "cloudfront:*",
          "secretsmanager:*",
          "logs:*",
          "lambda:*",
          "events:*",
          "cloudwatch:*",
          "iam:CreateServiceLinkedRole",
        ],
        resources: ["*"],
      }),
    );

    new cdk.CfnOutput(this, "GitHubShipRoleArn", {
      value: role.roleArn,
      description: "Repo Settings → Actions → Variables → AWS_SHIP_ROLE_ARN",
    });
  }
}
