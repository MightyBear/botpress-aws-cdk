import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as iam from "aws-cdk-lib/aws-iam";
import * as kms from "aws-cdk-lib/aws-kms";

export interface DatabaseStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
}

export class DatabaseStack extends cdk.Stack {
  public readonly clusterEndpoint: rds.Endpoint;
  public readonly password: secretsmanager.Secret;
  public readonly securityGroup: ec2.SecurityGroup;
  public readonly masterUsername = "master";

  constructor(scope: Construct, id: string, props: DatabaseStackProps) {
    super(scope, id, props);

    const { vpc } = props;

    const dbPassword = new secretsmanager.Secret(this, "MasterPassword", {
      generateSecretString: { excludePunctuation: true, includeSpace: false },
    });
    this.password = dbPassword;

    const securityGroup = new ec2.SecurityGroup(this, "SecurityGroup", { vpc });

    const clusterKey = new kms.Key(this, "ClusterKey", {
      enableKeyRotation: true,
    });

    const cluster = new rds.DatabaseCluster(this, "DbCluster", {
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_12_4,
      }),
      credentials: rds.Credentials.fromPassword(
        this.masterUsername,
        dbPassword.secretValue
      ),
      instanceProps: {
        vpc,
        instanceType: ec2.InstanceType.of(
          ec2.InstanceClass.R5,
          ec2.InstanceSize.LARGE
        ),
        vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        securityGroups: [securityGroup],
      },
      instances: 1,
      preferredMaintenanceWindow: "Mon:04:45-Mon:05:15",
      defaultDatabaseName: "default_db",
      storageEncryptionKey: clusterKey,
      port: 3306,
      backup: { retention: cdk.Duration.days(14) },
    });

    this.clusterEndpoint = cluster.clusterEndpoint;
    this.securityGroup = securityGroup;

    const bastionRole = new iam.Role(this, "BastionRole", {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
    });

    // Enables instances to use AWS SSM
    bastionRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore")
    );

    const bastionSecurityGroup = new ec2.SecurityGroup(
      this,
      "BastionSecurityGroup",
      { vpc }
    );
    securityGroup.connections.allowFrom(
      bastionSecurityGroup,
      ec2.Port.tcp(this.clusterEndpoint.port)
    );

    const userData = ec2.UserData.forLinux();
    userData.addCommands("yum -y install ec2-instance-connect");

    const bastionInstance = new ec2.Instance(this, "BastionInstance", {
      vpc,
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T2,
        ec2.InstanceSize.MICRO
      ),
      machineImage: ec2.MachineImage.latestAmazonLinux2(),
      securityGroup: bastionSecurityGroup,
      userData,
      role: bastionRole,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
    });

    // Tag used by the connect script to SSH into the instance
    cdk.Tags.of(bastionInstance).add("InstanceRole", "bastion", {
      applyToLaunchedInstances: true,
    });
  }
}
