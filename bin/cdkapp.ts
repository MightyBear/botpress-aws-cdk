#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { VpcStack } from "../lib/vpc-stack";
import { DatabaseStack } from "../lib/database-stack";
import { RedisStack } from "../lib/redis-stack";
import { ServicesStack } from "../lib/services-stack";
import { DomainsStack } from "../lib/domains-stack";
import { WAFStack } from "../lib/waf-stack";

const app = new cdk.App();

cdk.Tags.of(app).add("CostCenter", "botpress"); // Useful for cost reporting

const prefix = "Botpress";

const vpcStack = new VpcStack(app, `${prefix}-VPC`);

const dbStack = new DatabaseStack(app, `${prefix}-DB`, {
  vpc: vpcStack.vpc,
});

const redisStack = new RedisStack(app, `${prefix}-Redis`, {
  vpc: vpcStack.vpc,
});

const domainsStack = new DomainsStack(app, `${prefix}-Domains`);

const servicesStack = new ServicesStack(app, `${prefix}-Services`, {
  vpc: vpcStack.vpc,
  hostedZone: domainsStack.hostedZone,
  certificate: domainsStack.certificate,
  dbClusterEndpoint: dbStack.clusterEndpoint,
  redisPort: redisStack.primaryEndpoint.port,
  redisEndpoint: redisStack.primaryEndpoint,
  redisSecurityGroup: redisStack.securityGroup,
  dbClusterSecurityGroup: dbStack.securityGroup,
  dbClusterPort: dbStack.clusterEndpoint.port,
});

new WAFStack(app, `${prefix}-WAF`, {
  loadBalancer: servicesStack.loadBalancer,
});

app.synth();
