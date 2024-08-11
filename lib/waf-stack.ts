import { Stack, StackProps, RemovalPolicy } from "aws-cdk-lib";
import { Construct } from "constructs";
import { IApplicationLoadBalancer } from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { CfnWebACL, CfnWebACLAssociation } from "aws-cdk-lib/aws-wafv2";
import { CfnDeliveryStream } from "aws-cdk-lib/aws-kinesisfirehose";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";

export interface WAFStackProps extends StackProps {
  loadBalancer: IApplicationLoadBalancer;
}

export class WAFStack extends Stack {
  constructor(scope: Construct, id: string, props: WAFStackProps) {
    super(scope, id, props);

    const { loadBalancer } = props;

    const wafLoggingBucket = new Bucket(this, "WAFLoggingBucket", {
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const deliveryStreamRole = new Role(this, "DeliveryStreamRole", {
      assumedBy: new ServicePrincipal("firehose.amazonaws.com"),
    });

    wafLoggingBucket.grantReadWrite(deliveryStreamRole);

    new CfnDeliveryStream(this, "LoggingDeliveryStream", {
      deliveryStreamName: "aws-waf-logs",
      extendedS3DestinationConfiguration: {
        bucketArn: wafLoggingBucket.bucketArn,
        bufferingHints: { intervalInSeconds: 900, sizeInMBs: 1 },
        compressionFormat: "GZIP",
        roleArn: deliveryStreamRole.roleArn,
      },
    });

    // Based on this example: https://docs.aws.amazon.com/waf/latest/developerguide/waf-using-managed-rule-groups.html
    const acl = new CfnWebACL(this, "WebAcl", {
      defaultAction: { allow: {} },
      scope: "REGIONAL",
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: "MyMetric",
        sampledRequestsEnabled: true,
      },
      rules: [
        {
          name: "AWS-AWSManagedRulesCommonRuleSet",
          priority: 0,
          overrideAction: { none: {} },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: "MetricForAMRCRS",
          },
          statement: {
            managedRuleGroupStatement: {
              vendorName: "AWS",
              name: "AWSManagedRulesCommonRuleSet",
              excludedRules: [
                // Blocks file saves in the Botpress Code Editor
                { name: "EC2MetaDataSSRF_BODY" },
                { name: "NoUserAgent_HEADER" },
                { name: "SizeRestrictions_BODY" },
                { name: "GenericLFI_BODY" },
                { name: "GenericRFI_BODY" },
                // Blocks CSS statements
                { name: "CrossSiteScripting_BODY" },
                // Blocks the webchat via "Open Chat"
                { name: "GenericRFI_QUERYARGUMENTS" },
              ],
            },
          },
        },
        {
          name: "AWS-AWSManagedRulesSQLiRuleSet",
          priority: 1,
          overrideAction: { none: {} },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: "MetricForAMRSQLRS",
          },
          statement: {
            managedRuleGroupStatement: {
              vendorName: "AWS",
              name: "AWSManagedRulesSQLiRuleSet",
            },
          },
        },
      ],
    });

    new CfnWebACLAssociation(this, "AclAssociation", {
      webAclArn: acl.attrArn,
      resourceArn: loadBalancer.loadBalancerArn,
    });
  }
}
