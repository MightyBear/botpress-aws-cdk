import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as rds from "aws-cdk-lib/aws-rds";
import * as logs from "aws-cdk-lib/aws-logs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as route53Targets from "aws-cdk-lib/aws-route53-targets";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cloudmap from "aws-cdk-lib/aws-servicediscovery";
import * as path from "path";
import CfnParameterSecret from "./constructs/CfnParameterSecret";
import DucklingService from "./constructs/DucklingService";
import LangServerService from "./constructs/LangServerService";

export interface ServicesStackProps extends cdk.StackProps {
  dbClusterEndpointAddress: string;
  dbClusterPort: number;
  redisEndpointAddress: string;
  redisPort: number;
  redisSecurityGroupId: string;
  dbClusterSecurityGroupId: string;
  hostedZoneId: string;
  hostedZoneName: string;
}

export class ServicesStack extends cdk.Stack {
  public readonly loadBalancer: elbv2.IApplicationLoadBalancer;

  constructor(scope: Construct, id: string, props: ServicesStackProps) {
    super(scope, id, props);

    const {
      redisEndpointAddress,
      redisPort,
      redisSecurityGroupId,
      dbClusterSecurityGroupId,
      dbClusterEndpointAddress,
      dbClusterPort,
      hostedZoneId,
      hostedZoneName,
    } = props;

    // Import the hosted zone using its ID and name
    const hostedZone = route53.HostedZone.fromHostedZoneAttributes(
      this,
      "MightyBearGamesHostedZone",
      {
        hostedZoneId,
        zoneName: hostedZoneName,
      }
    );

    // Import the ACM certificate by ARN
    const certificate = acm.Certificate.fromCertificateArn(
      this,
      "MightyBearGamesCertificate",
      "arn:aws:acm:ap-southeast-1:071731816290:certificate/e6c547d7-7ff3-49f3-a157-9cbf7b6aad0d"
    );

    const vpc = ec2.Vpc.fromVpcAttributes(this, "BotPressVpc", {
      vpcId: "vpc-08e7cf9536a687628",
      availabilityZones: ["ap-southeast-1a", "ap-southeast-1b"],
      publicSubnetIds: ["subnet-0ad7cf889ef51c0e5", "subnet-0915000cb2b771e9e"],
      privateSubnetIds: [
        "subnet-05bccb9b928529382",
        "subnet-0c3db647e88ad5ec4",
      ],
    });

    const projectName = "bp";
    const internalTLD = "bp-internal";
    const publicTLD = hostedZone.zoneName;
    const webSubdomain = "botpress";
    const langServerSubdomain = "lang";
    const ducklingSubdomain = "duckling";

    // Define parameters
    const licenseParam = new cdk.CfnParameter(this, "License", {
      type: "String",
      noEcho: true,
    });
    const licenseKey = new CfnParameterSecret(
      this,
      "LicenseSecret",
      licenseParam
    );

    const dbURLParam = new cdk.CfnParameter(this, "DatabaseURL", {
      type: "String",
      noEcho: true,
    });
    const dbURL = new CfnParameterSecret(this, "DatabaseURLSecret", dbURLParam);

    // Define ECS Cluster
    const cluster = new ecs.Cluster(this, "Cluster", {
      vpc,
      containerInsights: true,
    });

    const image = ecs.ContainerImage.fromAsset(
      path.join(__dirname, "docker-image")
    );

    // Import existing security groups
    const redisSecurityGroup = ec2.SecurityGroup.fromSecurityGroupId(
      this,
      "RedisSecurityGroup",
      redisSecurityGroupId
    );

    const dbClusterSecurityGroup = ec2.SecurityGroup.fromSecurityGroupId(
      this,
      "DBClusterSecurityGroup",
      dbClusterSecurityGroupId
    );

    // Define RDS Endpoint
    const dbClusterEndpoint = new rds.Endpoint(
      dbClusterEndpointAddress,
      dbClusterPort
    );

    // Define Redis Endpoint
    const redisEndpoint = {
      address: redisEndpointAddress,
      port: ec2.Port.tcp(redisPort),
    };

    // Allow outgoing connections to PostgreSQL cluster
    dbClusterSecurityGroup.addIngressRule(
      redisSecurityGroup,
      ec2.Port.tcp(dbClusterPort),
      "PostgreSQL access"
    );

    // Allow outgoing connections to Redis cluster
    redisSecurityGroup.addIngressRule(
      redisSecurityGroup,
      ec2.Port.tcp(redisPort),
      "Redis access"
    );

    // Define Application Load Balancer
    const loadBalancer = new elbv2.ApplicationLoadBalancer(this, "LB", {
      vpc,
      internetFacing: true,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },
    });
    this.loadBalancer = loadBalancer;

    const listener80 = loadBalancer.addListener("Listener80", {
      port: 80,
    });

    listener80.addAction("httpsRedirect", {
      action: elbv2.ListenerAction.redirect({
        protocol: "HTTPS",
        port: "443",
        permanent: true,
      }),
    });

    const listener443 = loadBalancer.addListener("Listener", {
      port: 443,
      certificates: [certificate],
    });

    const dnsNamespace = new cloudmap.PrivateDnsNamespace(this, "Namespace", {
      vpc,
      name: internalTLD,
    });

    // const duckling = new DucklingService(this, "Duckling", {
    //   cluster,
    //   vpc,
    //   projectName,
    //   dnsNamespace,
    // });

    // const langServer = new LangServerService(this, "Lang", {
    //   cluster,
    //   vpc,
    //   projectName,
    //   dnsNamespace,
    //   domainName: publicTLD,
    // });

    // const webTaskDef = new ecs.FargateTaskDefinition(this, "WebTaskDef", {
    //   memoryLimitMiB: 4096,
    //   cpu: 1024,
    // });

    // const webContainer = webTaskDef.addContainer("web", {
    //   image: image,
    //   entryPoint: ["/bin/sh", "-c"],
    //   command: ["./bp"],
    //   environment: {
    //     BP_PRODUCTION: "true",
    //     BP_MODULES_PATH: "/botpress/modules:/botpress/additional-modules",
    //     BP_DECISION_MIN_NO_REPEAT: "1ms",
    //     BPFS_STORAGE: "database",
    //     CLUSTER_ENABLED: "true",
    //     PRO_ENABLED: "true",
    //     EXPOSED_LICENSE_SERVER: "https://license.botpress.io/",
    //     VERBOSITY_LEVEL: "3",
    //     AUTO_MIGRATE: "true",
    //     DATABASE_POOL: '{"min": 2, "max": 5}',
    //     REDIS_URL: `redis://${redisEndpoint.address}:${redisEndpoint.port}/0`,
    //     EXTERNAL_URL: `https://${webSubdomain}.${publicTLD}`,
    //     BP_MODULE_NLU_LANGUAGESOURCES: `[{"endpoint":"http://${langServerSubdomain}.${internalTLD}:${langServer.port}"}]`,
    //     BP_MODULE_NLU_DUCKLINGURL: `http://${ducklingSubdomain}.${internalTLD}:${duckling.port}`,
    //   },
    //   secrets: {
    //     BP_LICENSE_KEY: ecs.Secret.fromSecretsManager(licenseKey.secret),
    //     DATABASE_URL: ecs.Secret.fromSecretsManager(dbURL.secret),
    //   },
    //   logging: ecs.LogDrivers.awsLogs({
    //     logRetention: logs.RetentionDays.ONE_MONTH,
    //     streamPrefix: `${projectName}-web`,
    //   }),
    // });

    // webContainer.addPortMappings({ containerPort: 3000 });

    // const webSecurityGroup = new ec2.SecurityGroup(this, "WebSecurityGroup", {
    //   vpc,
    // });

    // // Allow outgoing connections to PostgreSQL cluster
    // dbClusterSecurityGroup.addIngressRule(
    //   webSecurityGroup,
    //   ec2.Port.tcp(dbClusterPort),
    //   "PostgreSQL access"
    // );

    // // Allow outgoing connections to Redis cluster
    // redisSecurityGroup.addIngressRule(
    //   webSecurityGroup,
    //   ec2.Port.tcp(redisPort),
    //   "Redis access"
    // );

    // langServer.allowIngress(webSecurityGroup);
    // duckling.allowIngress(webSecurityGroup);

    // const webService = new ecs.FargateService(this, "WebService", {
    //   cluster,
    //   taskDefinition: webTaskDef,
    //   assignPublicIp: false,
    //   securityGroups: [webSecurityGroup],
    //   enableECSManagedTags: true,
    //   propagateTags: ecs.PropagatedTagSource.SERVICE,
    //   desiredCount: 2,
    // });

    // listener443.addTargets("ECS", {
    //   port: 80,
    //   targets: [webService],
    //   healthCheck: {
    //     path: "/status",
    //     interval: cdk.Duration.seconds(60),
    //     healthyThresholdCount: 2,
    //     timeout: cdk.Duration.seconds(10),
    //     unhealthyThresholdCount: 10,
    //   },
    //   stickinessCookieDuration: cdk.Duration.hours(1),
    // });

    // new route53.ARecord(this, "Record", {
    //   zone: hostedZone,
    //   recordName: webSubdomain,
    //   target: route53.RecordTarget.fromAlias(
    //     new route53Targets.LoadBalancerTarget(loadBalancer)
    //   ),
    // });
  }
}
