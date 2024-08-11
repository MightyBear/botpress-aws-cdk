import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as rds from "aws-cdk-lib/aws-rds";
import * as logs from "aws-cdk-lib/aws-logs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { PrimaryEndpoint as RedisPrimaryEndpoint } from "./redis-stack";
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
  vpc: ec2.IVpc;
  hostedZone: route53.IHostedZone;
  certificate: acm.ICertificate;
  dbClusterEndpoint: rds.Endpoint;
  redisEndpoint: RedisPrimaryEndpoint;
  dbClusterSecurityGroup: ec2.SecurityGroup;
  dbClusterPort: number;
  redisPort: ec2.Port;
  redisSecurityGroup: ec2.SecurityGroup;
}

export class ServicesStack extends cdk.Stack {
  public readonly loadBalancer: elbv2.IApplicationLoadBalancer;

  constructor(scope: Construct, id: string, props: ServicesStackProps) {
    super(scope, id, props);

    const {
      vpc,
      hostedZone,
      certificate,
      redisEndpoint,
      redisPort,
      redisSecurityGroup,
      dbClusterSecurityGroup,
      dbClusterPort,
    } = props;

    const projectName = "bp";
    const internalTLD = "bp-internal";
    const publicTLD = hostedZone.zoneName;
    const webSubdomain = "botpress";
    const langServerSubdomain = "lang";
    const ducklingSubdomain = "duckling";

    // ======= PARAMETERS
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

    // RESOURCES
    const cluster = new ecs.Cluster(this, "Cluster", {
      vpc,
      containerInsights: true,
    });

    const image = ecs.ContainerImage.fromAsset(
      path.join(__dirname, "docker-image")
    );

    const securityGroup = new ec2.SecurityGroup(this, "SecurityGroup", {
      vpc,
    });

    // Allow outgoing connections to Posgresql cluster
    dbClusterSecurityGroup.addIngressRule(
      securityGroup,
      ec2.Port.tcp(dbClusterPort),
      "Postgresql access"
    );

    // Allow outgoing connections to Redis cluster
    redisSecurityGroup.addIngressRule(securityGroup, redisPort, "Redis access");

    const loadBalancer = new elbv2.ApplicationLoadBalancer(this, "LB", {
      vpc: cluster.vpc,
      internetFacing: true,
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

    const duckling = new DucklingService(this, "Duckling", {
      cluster,
      vpc,
      projectName,
      dnsNamespace,
    });

    const langServer = new LangServerService(this, "Lang", {
      cluster,
      vpc,
      projectName,
      dnsNamespace,
      domainName: publicTLD,
    });

    const webTaskDef = new ecs.FargateTaskDefinition(this, "WebTaskDef", {
      memoryLimitMiB: 4096,
      cpu: 1024,
    });

    const webContainer = webTaskDef.addContainer("web", {
      image: image,
      entryPoint: ["/bin/sh", "-c"],
      command: ["./bp"],
      environment: {
        BP_PRODUCTION: "true",
        BP_MODULES_PATH: "/botpress/modules:/botpress/additional-modules",
        BP_DECISION_MIN_NO_REPEAT: "1ms",
        BPFS_STORAGE: "database",
        CLUSTER_ENABLED: "true",
        PRO_ENABLED: "true",
        EXPOSED_LICENSE_SERVER: "https://license.botpress.io/",
        VERBOSITY_LEVEL: "3",
        AUTO_MIGRATE: "true",
        DATABASE_POOL: '{"min": 2, "max": 5}',
        REDIS_URL: `redis://${redisEndpoint.address}:${redisEndpoint.port}/0`,
        EXTERNAL_URL: `https://${webSubdomain}.${publicTLD}`,
        BP_MODULE_NLU_LANGUAGESOURCES: `[{"endpoint":"http://${langServerSubdomain}.${internalTLD}:${langServer.port}"}]`,
        BP_MODULE_NLU_DUCKLINGURL: `http://${ducklingSubdomain}.${internalTLD}:${duckling.port}`,
      },
      secrets: {
        BP_LICENSE_KEY: ecs.Secret.fromSecretsManager(licenseKey.secret),
        DATABASE_URL: ecs.Secret.fromSecretsManager(dbURL.secret),
      },
      logging: ecs.LogDrivers.awsLogs({
        logRetention: logs.RetentionDays.ONE_MONTH,
        streamPrefix: `${projectName}-web`,
      }),
    });

    webContainer.addPortMappings({ containerPort: 3000 });

    const webSecurityGroup = new ec2.SecurityGroup(this, "WebSecurityGroup", {
      vpc,
    });

    // Allow outgoing connections to Posgresql cluster
    dbClusterSecurityGroup.addIngressRule(
      webSecurityGroup,
      ec2.Port.tcp(dbClusterPort),
      "Postgresql access"
    );

    // Allow outgoing connections to Redis cluster
    redisSecurityGroup.addIngressRule(
      webSecurityGroup,
      redisPort,
      "Redis access"
    );

    langServer.allowIngress(webSecurityGroup);
    duckling.allowIngress(webSecurityGroup);

    const webService = new ecs.FargateService(this, "WebService", {
      cluster,
      taskDefinition: webTaskDef,
      assignPublicIp: false,
      securityGroups: [webSecurityGroup],
      enableECSManagedTags: true,
      propagateTags: ecs.PropagatedTagSource.SERVICE,
      desiredCount: 2,
    });

    listener443.addTargets("ECS", {
      port: 80,
      targets: [webService],
      healthCheck: {
        path: "/status",
        interval: cdk.Duration.seconds(60),
        healthyThresholdCount: 2,
        timeout: cdk.Duration.seconds(10),
        unhealthyThresholdCount: 10,
      },
      stickinessCookieDuration: cdk.Duration.hours(1),
    });

    new route53.ARecord(this, "Record", {
      zone: hostedZone,
      recordName: webSubdomain,
      target: route53.RecordTarget.fromAlias(
        new route53Targets.LoadBalancerTarget(loadBalancer)
      ),
    });
  }
}
