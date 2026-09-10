import * as fs from "fs";
import * as path from "path";
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr_assets from "aws-cdk-lib/aws-ecr-assets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as ssm from "aws-cdk-lib/aws-ssm";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cw_actions from "aws-cdk-lib/aws-cloudwatch-actions";

export interface YucgOutreachStackProps extends cdk.StackProps {
  envName: string;
}

/**
 * Club host: one t3.small (same process as localhost), SQLite on retained EBS,
 * CloudFront HTTPS via VPC origin (no world :80), S3 catalog, Bedrock.
 * No Fargate, ALB, NAT, RDS, or Amplify.
 * 70 members / ~12 concurrent. Scale-up = bigger instance; two boxes needs RDS.
 */
export class YucgOutreachStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: YucgOutreachStackProps) {
    super(scope, id, props);
    const { envName } = props;

    const catalog = new s3.Bucket(this, "Catalog", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      autoDeleteObjects: false,
      lifecycleRules: [
        { prefix: "exports/", expiration: cdk.Duration.days(30) },
        { prefix: "discovery/", expiration: cdk.Duration.days(30) },
      ],
    });

    const appSecrets = new secretsmanager.Secret(this, "AppSecrets", {
      secretName: `yucg-outreach/${envName}/app`,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          GOOGLE_CLIENT_ID: "",
          GOOGLE_CLIENT_SECRET: "",
          APIFY_API_TOKEN: "",
          TAVILY_API_KEY: "",
          SLACK_CLIENT_ID: "",
          SLACK_CLIENT_SECRET: "",
          SLACK_BOT_TOKEN: "",
          VERIFALIA_API_KEY: "",
        }),
        generateStringKey: "JWT_SECRET",
        excludePunctuation: true,
        passwordLength: 48,
      },
    });

    const vpc = ec2.Vpc.fromLookup(this, "DefaultVpc", { isDefault: true });
    const az = vpc.publicSubnets[0].availabilityZone;

    const dataVol = new ec2.Volume(this, "SqliteDisk", {
      availabilityZone: az,
      size: cdk.Size.gibibytes(8),
      volumeType: ec2.EbsDeviceVolumeType.GP3,
      encrypted: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const logGroup = new logs.LogGroup(this, "ApiLogs", {
      logGroupName: `/yucg-outreach/${envName}`,
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const image = new ecr_assets.DockerImageAsset(this, "AppImage", {
      directory: path.join(__dirname, "../.."),
      file: "docker/app.Dockerfile",
      platform: ecr_assets.Platform.LINUX_AMD64,
      exclude: [
        "infra/cdk.out",
        "infra/node_modules",
        "frontend/node_modules",
        "backend/venv",
        "backend/.venv",
        "data",
      ],
    });

    const role = new iam.Role(this, "BoxRole", {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore"),
        iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonEC2ContainerRegistryReadOnly"),
      ],
    });
    catalog.grantReadWrite(role);
    appSecrets.grantRead(role);
    image.repository.grantPull(role);
    logGroup.grantWrite(role);
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["bedrock:InvokeModel"],
        // Same finite models exposed by the backend; no arbitrary model marketplace access.
        resources: [
          ...["us.anthropic.claude-opus-5", "us.anthropic.claude-sonnet-5", "us.anthropic.claude-haiku-4-5-20251001-v1:0"]
            .map(model => `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/${model}`),
          ...["us-east-1", "us-east-2", "us-west-2"].flatMap(region =>
            ["anthropic.claude-opus-5", "anthropic.claude-sonnet-5", "anthropic.claude-haiku-4-5-20251001-v1:0"]
              .map(model => `arn:aws:bedrock:${region}::foundation-model/${model}`)),
        ],
      }),
    );

    const publicParamName = `/yucg-outreach/${envName}/public-url`;
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["ssm:GetParameter"],
        resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter${publicParamName}`],
      }),
    );

    const sg = new ec2.SecurityGroup(this, "BoxSg", {
      vpc,
      description: "YUCG outreach box",
      allowAllOutbound: true,
    });
    const cfOriginFacing = ec2.PrefixList.fromLookup(this, "CfOriginFacing", {
      prefixListName: "com.amazonaws.global.cloudfront.origin-facing",
    });
    sg.addIngressRule(
      ec2.Peer.prefixList(cfOriginFacing.prefixListId),
      ec2.Port.tcp(80),
      "CloudFront origin-facing only",
    );
    sg.addIngressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.tcp(80),
      "CloudFront VPC-origin ENI in this VPC",
    );

    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      `export YUCG_IMAGE=${image.imageUri}`,
      `export YUCG_ECR=${cdk.Fn.select(0, cdk.Fn.split("/", image.imageUri))}`,
      `export YUCG_SECRET_ARN=${appSecrets.secretArn}`,
      `export YUCG_BUCKET=${catalog.bucketName}`,
      `export YUCG_REGION=${this.region}`,
      `export YUCG_PUBLIC_PARAM=${publicParamName}`,
      `export YUCG_LOG_GROUP=${logGroup.logGroupName}`,
    );
    userData.addCommands(fs.readFileSync(path.join(__dirname, "user-data.sh"), "utf8"));

    const box = new ec2.Instance(this, "Box", {
      vpc,
      vpcSubnets: { availabilityZones: [az], subnetType: ec2.SubnetType.PUBLIC },
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.SMALL),
      machineImage: ec2.MachineImage.latestAmazonLinux2023({
        cpuType: ec2.AmazonLinuxCpuType.X86_64,
      }),
      role,
      securityGroup: sg,
      userData,
      userDataCausesReplacement: true,
      // Egress only (ECR, Bedrock, Google). HTTP in is CloudFront VPC origin, not this IP.
      associatePublicIpAddress: true,
      blockDevices: [
        {
          deviceName: "/dev/xvda",
          volume: ec2.BlockDeviceVolume.ebs(20, {
            volumeType: ec2.EbsDeviceVolumeType.GP3,
            encrypted: true,
          }),
        },
      ],
      requireImdsv2: true,
    });
    box.instance.addPropertyOverride("DisableApiTermination", envName === "prod");

    new ec2.CfnVolumeAttachment(this, "SqliteAttach", {
      volumeId: dataVol.volumeId,
      instanceId: box.instanceId,
      device: "/dev/xvdf",
    });

    const cdn = new cloudfront.Distribution(this, "Cdn", {
      comment: `yucg-outreach-${envName}`,
      defaultBehavior: {
        origin: origins.VpcOrigin.withEc2Instance(box, {
          protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
          httpPort: 80,
          // New-account CloudFront quota is 60s; 120/180 fail deploy.
          readTimeout: cdk.Duration.seconds(60),
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
      },
    });

    const publicUrl = `https://${cdn.distributionDomainName}`;
    const publicParam = new ssm.StringParameter(this, "PublicUrl", {
      parameterName: publicParamName,
      stringValue: publicUrl,
    });
    publicParam.node.addDependency(cdn);

    new cdk.CfnOutput(this, "AppUrl", { value: publicUrl });
    new cdk.CfnOutput(this, "GoogleRedirectUri", {
      value: `${publicUrl}/api/auth/google/callback`,
    });
    new cdk.CfnOutput(this, "AppSecretsArn", { value: appSecrets.secretArn });
    new cdk.CfnOutput(this, "CatalogBucket", { value: catalog.bucketName });
    const hostFn = new lambda.Function(this, "HostControl", {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "index.handler",
      timeout: cdk.Duration.seconds(30),
      environment: { INSTANCE_ID: box.instanceId },
      code: lambda.Code.fromInline(
        fs.readFileSync(path.join(__dirname, "host_control.py"), "utf8"),
      ),
    });
    hostFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["ec2:StartInstances", "ec2:StopInstances", "ec2:DescribeInstances"],
        resources: ["*"],
      }),
    );

    const officeHours = String(this.node.tryGetContext("officeHours") || "") === "1";
    if (officeHours) {
      new events.Rule(this, "OfficeStart", {
        schedule: events.Schedule.cron({ minute: "0", hour: "12", weekDay: "MON-FRI" }),
        description: "Start outreach box weekdays 12:00 UTC",
      }).addTarget(
        new targets.LambdaFunction(hostFn, {
          event: events.RuleTargetInput.fromObject({ action: "start" }),
        }),
      );
      new events.Rule(this, "OfficeStop", {
        schedule: events.Schedule.cron({ minute: "0", hour: "4", weekDay: "TUE-SAT" }),
        description: "Stop outreach box 04:00 UTC after weekday use",
      }).addTarget(
        new targets.LambdaFunction(hostFn, {
          event: events.RuleTargetInput.fromObject({ action: "stop" }),
        }),
      );
    }

    const idleStop = String(this.node.tryGetContext("idleStop") || "") === "1";
    if (idleStop) {
      const idle = new cloudwatch.Alarm(this, "IdleCpu", {
        metric: new cloudwatch.Metric({
          namespace: "AWS/EC2",
          metricName: "CPUUtilization",
          dimensionsMap: { InstanceId: box.instanceId },
          statistic: "Average",
          period: cdk.Duration.hours(1),
        }),
        threshold: 5,
        evaluationPeriods: 8,
        comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        alarmDescription: "Instance idle 8h — stop to save compute (idleStop=1)",
      });
      idle.addAlarmAction(new cw_actions.LambdaAction(hostFn));
    }

    const credits = new cloudwatch.Alarm(this, "CpuCreditsLow", {
      metric: new cloudwatch.Metric({
        namespace: "AWS/EC2",
        metricName: "CPUCreditBalance",
        dimensionsMap: { InstanceId: box.instanceId },
        statistic: "Average",
        period: cdk.Duration.minutes(15),
      }),
      threshold: 20,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: "t3 CPU credits low — Find/Studio will feel slow; stop extra crawls or size up",
    });
    void credits;

    new cdk.CfnOutput(this, "InstanceId", { value: box.instanceId });
    new cdk.CfnOutput(this, "HostControlFunctionName", { value: hostFn.functionName });
  }
}
