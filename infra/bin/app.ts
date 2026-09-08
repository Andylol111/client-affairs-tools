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

const connectionArn = (app.node.tryGetContext("githubConnectionArn") as string | undefined) || "";
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
