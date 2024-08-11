import { Construct } from "constructs";
import * as cdk from "aws-cdk-lib";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";

export default class CfnParameterSecret extends Construct {
  public readonly secret: secretsmanager.Secret;

  constructor(scope: Construct, id: string, parameter: cdk.CfnParameter) {
    super(scope, id);

    this.secret = new secretsmanager.Secret(this, `${id}-Secret`, {
      secretStringValue: cdk.SecretValue.unsafePlainText(
        parameter.valueAsString
      ),
    });
  }
}
