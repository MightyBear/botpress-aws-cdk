import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as route53 from "aws-cdk-lib/aws-route53";

export class DomainsStack extends cdk.Stack {
  public readonly hostedZone: route53.IHostedZone;
  public readonly certificate: acm.ICertificate;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const domainNameParam = new cdk.CfnParameter(this, "DomainName", {
      type: "String",
      noEcho: true,
    });

    const domainName = domainNameParam.valueAsString;

    const hostedZone = new route53.HostedZone(this, "HostedZone", {
      zoneName: domainName,
    });
    this.hostedZone = hostedZone;

    this.certificate = new acm.Certificate(this, "Certificate", {
      domainName: domainName,
      subjectAlternativeNames: [`*.${domainName}`],
      validation: acm.CertificateValidation.fromDns(hostedZone),
    });
  }
}
