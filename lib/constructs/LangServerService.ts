import { Construct } from "constructs";
import * as cdk from "aws-cdk-lib";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as cloudmap from "aws-cdk-lib/aws-servicediscovery";
import * as path from "path";

export interface LangServerServiceProps {
  projectName: string;
  vpc: ec2.IVpc;
  cluster: ecs.Cluster;
  dnsNamespace: cloudmap.INamespace;
  domainName: string;
}

export default class LangServerService extends Construct {
  public readonly securityGroup: ec2.ISecurityGroup;
  public readonly port = 3100;

  constructor(scope: Construct, id: string, props: LangServerServiceProps) {
    super(scope, id);

    const { projectName, vpc, cluster, dnsNamespace, domainName } = props;

    const subdomain = "lang";

    const image = ecs.ContainerImage.fromAsset(
      path.join(__dirname, "..", "docker-image")
    );

    const taskDef = new ecs.FargateTaskDefinition(this, "TaskDef", {
      memoryLimitMiB: 4096,
      cpu: 512,
    });

    const container = taskDef.addContainer("lang", {
      image: image,
      entryPoint: ["/bin/sh", "-c"],
      command: [
        `./bp lang --langDir /botpress/lang --port ${this.port} --offline --dim 300`,
      ],
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
        EXTERNAL_URL: `https://${domainName}`,
      },
      logging: ecs.LogDrivers.awsLogs({
        logRetention: logs.RetentionDays.ONE_MONTH,
        streamPrefix: `${projectName}-lang`,
      }),
    });

    container.addPortMappings({
      containerPort: this.port,
      name: "lang", // This name should match the portMappingName in serviceConnectConfiguration
    });

    const securityGroup = new ec2.SecurityGroup(this, "SecurityGroup", {
      vpc,
    });
    this.securityGroup = securityGroup;

    new ecs.FargateService(this, "Service", {
      cluster,
      taskDefinition: taskDef,
      assignPublicIp: false,
      securityGroups: [securityGroup],
      enableExecuteCommand: true,
      propagateTags: ecs.PropagatedTagSource.SERVICE,
      desiredCount: 1,
      serviceConnectConfiguration: {
        namespace: dnsNamespace.namespaceName,
        services: [
          {
            portMappingName: "lang",
            dnsName: subdomain,
            port: this.port,
          },
        ],
      },
    });
  }

  public allowIngress(securityGroup: ec2.ISecurityGroup) {
    this.securityGroup.addIngressRule(securityGroup, ec2.Port.tcp(this.port));
  }
}
