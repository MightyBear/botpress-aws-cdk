import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as elasticache from "aws-cdk-lib/aws-elasticache";

export interface PrimaryEndpoint {
  address: string;
  port: ec2.Port;
}

export interface RedisStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
}

export class RedisStack extends cdk.Stack {
  private static readonly portNumber = 6379;

  public readonly securityGroup: ec2.SecurityGroup;
  public readonly primaryEndpoint: PrimaryEndpoint;

  constructor(scope: Construct, id: string, props: RedisStackProps) {
    super(scope, id, props);

    const { vpc } = props;

    const subnetGroup = new elasticache.CfnSubnetGroup(
      this,
      "CacheSubnetGroup",
      {
        description: "Subnet group for the Redis cluster",
        subnetIds: vpc.privateSubnets.map((s) => s.subnetId),
      }
    );

    const sg = new ec2.SecurityGroup(this, "RedisSecurityGroup", { vpc });
    this.securityGroup = sg;

    const replicationGroup = new elasticache.CfnReplicationGroup(
      this,
      "RedisReplicationGroup",
      {
        replicationGroupDescription: "Replication group for Redis",
        numCacheClusters: 1,
        automaticFailoverEnabled: false,
        transitEncryptionEnabled: false,
        cacheSubnetGroupName: subnetGroup.ref,
        engine: "redis",
        cacheNodeType: "cache.m5.large",
        securityGroupIds: [sg.securityGroupId],
        port: RedisStack.portNumber,
        atRestEncryptionEnabled: true,
      }
    );

    this.primaryEndpoint = {
      address: replicationGroup.attrPrimaryEndPointAddress,
      port: ec2.Port.tcp(RedisStack.portNumber),
    };
  }
}
