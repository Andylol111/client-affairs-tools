import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as codebuild from "aws-cdk-lib/aws-codebuild";
import * as codepipeline from "aws-cdk-lib/aws-codepipeline";
import * as actions from "aws-cdk-lib/aws-codepipeline-actions";
import * as iam from "aws-cdk-lib/aws-iam";

export interface YucgPipelineStackProps extends cdk.StackProps {
  envName: string;
  connectionArn: string;
  githubOwner: string;
  githubRepo: string;
  githubBranch: string;
}

/**
 * Ships the app from GitHub. No DockerImageAsset here — CodeBuild has Docker
 * and runs `cdk deploy YucgOutreach-$env`. CloudShell only deploys *this* stack.
 */
export class YucgPipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: YucgPipelineStackProps) {
    super(scope, id, props);
    const { envName, connectionArn, githubOwner, githubRepo, githubBranch } = props;

    const project = new codebuild.PipelineProject(this, "Ship", {
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        privileged: true,
      },
      environmentVariables: {
        CDK_DEFAULT_ACCOUNT: { value: this.account },
        CDK_DEFAULT_REGION: { value: this.region },
        YUCG_ENV: { value: envName },
      },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: "0.2",
        phases: {
          install: {
            "runtime-versions": { nodejs: "22" },
            commands: ["cd infra && npm ci && npx cdk --version"],
          },
          build: {
            commands: [
              "cd infra && npx cdk deploy YucgOutreach-$YUCG_ENV -c env=$YUCG_ENV --require-approval never",
            ],
          },
        },
      }),
    });

    project.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["sts:AssumeRole"],
        resources: [
          `arn:aws:iam::${this.account}:role/cdk-hnb659fds-*-role-${this.account}-${this.region}`,
        ],
      }),
    );
    project.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["cloudformation:*", "ssm:GetParameter", "ssm:GetParameters", "ecr:*", "s3:*"],
        resources: ["*"],
      }),
    );
    project.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["iam:PassRole", "iam:GetRole", "iam:CreateRole", "iam:AttachRolePolicy", "iam:PutRolePolicy"],
        resources: ["*"],
      }),
    );
    project.addToRolePolicy(
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

    const sourceOut = new codepipeline.Artifact("src");
    new codepipeline.Pipeline(this, "Pipe", {
      pipelineType: codepipeline.PipelineType.V2,
      stages: [
        {
          stageName: "Source",
          actions: [
            new actions.CodeStarConnectionsSourceAction({
              actionName: "GitHub",
              connectionArn,
              owner: githubOwner,
              repo: githubRepo,
              branch: githubBranch,
              output: sourceOut,
            }),
          ],
        },
        {
          stageName: "Deploy",
          actions: [
            new actions.CodeBuildAction({
              actionName: "CdkDeploy",
              project,
              input: sourceOut,
            }),
          ],
        },
      ],
    });

    new cdk.CfnOutput(this, "PipelineHint", {
      value: `Push ${githubOwner}/${githubRepo}@${githubBranch} → builds docker/app.Dockerfile on AWS`,
    });
  }
}
