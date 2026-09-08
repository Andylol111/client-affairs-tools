#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { YucgOutreachStack } from "../lib/yucg-outreach-stack";
import { YucgPipelineStack } from "../lib/yucg-pipeline-stack";

const app = new cdk.App();
const envName = (app.node.tryGetContext("env") as string | undefined) || "dev";
const awsEnv = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION || "us-east-1",
};

new YucgOutreachStack(app, `YucgOutreach-${envName}`, {
  envName,
  env: awsEnv,
});

const connectionArn =
  String(app.node.tryGetContext("githubConnectionArn") || "").match(
    /arn:aws[a-zA-Z0-9-]*:code(?:connections|star-connections):[a-z0-9-]+:\d{12}:connection\/[0-9a-f-]+/i,
  )?.[0] || "";
if (connectionArn) {
  new YucgPipelineStack(app, `YucgPipeline-${envName}`, {
    envName,
    connectionArn,
    githubOwner: (app.node.tryGetContext("githubOwner") as string | undefined) || "Andylol111",
    githubRepo: (app.node.tryGetContext("githubRepo") as string | undefined) || "client-affairs-tools",
    githubBranch: (app.node.tryGetContext("githubBranch") as string | undefined) || "yucg-outreach",
    env: awsEnv,
  });
}
