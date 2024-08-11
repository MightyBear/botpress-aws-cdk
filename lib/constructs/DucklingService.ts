import { Construct } from "constructs";
import * as cdk from "aws-cdk-lib";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as cloudmap from "aws-cdk-lib/aws-servicediscovery";
import * as path from "path";

export interface DucklingServiceProps {
  projectName: string;
  vpc: ec2.IVpc;
  cluster: ecs.Cluster;
  dnsNamespace: cloudmap.INamespace;
}

export default class DucklingService extends Construct {
  public readonly securityGroup: ec2.ISecurityGroup;
  public readonly port = 8000;

  constructor(scope: Construct, id: string, props: DucklingServiceProps) {
    super(scope, id);

    const { projectName, vpc, cluster, dnsNamespace } = props;

    const image = ecs.ContainerImage.fromAsset(
      path.join(__dirname, "..", "docker-image")
    );

    const subdomain = "duckling";

    const ducklingTaskDef = new ecs.FargateTaskDefinition(this, "TaskDef", {
      memoryLimitMiB: 512,
      cpu: 256,
    });

    const container = ducklingTaskDef.addContainer("duckling", {
      image: image,
      entryPoint: ["/bin/sh", "-c"],
      command: [`./duckling -p ${this.port}`],
      logging: ecs.LogDrivers.awsLogs({
        logRetention: logs.RetentionDays.ONE_MONTH,
        streamPrefix: `${projectName}-prod-duckling`,
      }),
    });
    container.addPortMappings({
      containerPort: this.port,
      name: "duckling", // Add this line
    });

    const securityGroup = new ec2.SecurityGroup(this, "SecurityGroup", {
      vpc,
    });
    this.securityGroup = securityGroup;

    new ecs.FargateService(this, "Service", {
      cluster,
      taskDefinition: ducklingTaskDef,
      assignPublicIp: false,
      securityGroups: [securityGroup],
      enableExecuteCommand: true,
      propagateTags: ecs.PropagatedTagSource.SERVICE,
      desiredCount: 1,
      serviceConnectConfiguration: {
        namespace: dnsNamespace.namespaceName,
        services: [
          {
            portMappingName: "duckling",
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
