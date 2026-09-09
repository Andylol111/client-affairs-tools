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
            "token.actions.githubusercontent.com:sub": `repo:${repo}:environment:production`,
          },
        },
        "sts:AssumeRoleWithWebIdentity",
      ),
    });

    // Application shipping does not own infrastructure or read application secrets.
    role.addToPolicy(new iam.PolicyStatement({
      actions: ["ecr:GetAuthorizationToken", "ssm:GetCommandInvocation"], resources: ["*"],
    }));
    role.addToPolicy(new iam.PolicyStatement({
      actions: ["cloudformation:DescribeStacks"],
      resources: [`arn:aws:cloudformation:${this.region}:${this.account}:stack/YucgOutreach-${envName}/*`],
    }));
    role.addToPolicy(new iam.PolicyStatement({
      actions: ["ecr:BatchCheckLayerAvailability", "ecr:InitiateLayerUpload", "ecr:UploadLayerPart", "ecr:CompleteLayerUpload", "ecr:PutImage", "ecr:DescribeImages"],
      resources: [`arn:aws:ecr:${this.region}:${this.account}:repository/cdk-hnb659fds-container-assets-${this.account}-${this.region}`],
    }));
    role.addToPolicy(new iam.PolicyStatement({
      actions: ["ssm:SendCommand"], resources: [`arn:aws:ssm:${this.region}::document/AWS-RunShellScript`],
    }));
    role.addToPolicy(new iam.PolicyStatement({
      actions: ["ssm:SendCommand"], resources: [`arn:aws:ec2:${this.region}:${this.account}:instance/*`],
      conditions: { StringEquals: { "ssm:resourceTag/aws:cloudformation:stack-name": `YucgOutreach-${envName}` } },
    }));

    new cdk.CfnOutput(this, "GitHubShipRoleArn", {
      value: role.roleArn,
      description: "Repo Settings → Actions → Variables → AWS_SHIP_ROLE_ARN",
    });
  }
}
