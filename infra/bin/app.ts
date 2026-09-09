#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { YucgOutreachStack } from "../lib/yucg-outreach-stack";
import { YucgGithubOidcStack } from "../lib/yucg-github-oidc-stack";

const app = new cdk.App();
const envName = (app.node.tryGetContext("env") as string | undefined) || "dev";
const awsEnv = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION || "us-east-1",
};
const githubOwner = (app.node.tryGetContext("githubOwner") as string | undefined) || "Andylol111";
const githubRepo = (app.node.tryGetContext("githubRepo") as string | undefined) || "client-affairs-tools";

new YucgOutreachStack(app, `YucgOutreach-${envName}`, {
  envName,
  env: awsEnv,
});

new YucgGithubOidcStack(app, `YucgGithubOidc-${envName}`, {
  envName,
  githubOwner,
  githubRepo,
  env: awsEnv,
});
