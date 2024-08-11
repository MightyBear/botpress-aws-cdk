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

// const domainsStack = new DomainsStack(app, `${prefix}-Domains`);

const servicesStack = new ServicesStack(app, `${prefix}-Services`, {
  dbClusterEndpointAddress:
    "botpress-db-dbcluster224236ef-zespmmfzkczp.cluster-chfxriuztqln.ap-southeast-1.rds.amazonaws.com",
  dbClusterPort: 3306,
  redisEndpointAddress:
    "bor7fndkkyp6m36-001.ol7zdz.0001.apse1.cache.amazonaws.com",
  redisPort: 6379,
  redisSecurityGroupId: "sg-07090f94f4e96ae4b", // Replace with the actual Redis security group ID
  dbClusterSecurityGroupId: "sg-01915bd1a75e30932", // Replace with the actual DB cluster security group ID
  hostedZoneId: "Z31RNQYBW7G7ZV", // Use your actual hosted zone ID
  hostedZoneName: "mightybeargames.com", // Use your actual hosted zone name
});

// new WAFStack(app, `${prefix}-WAF`, {
//   loadBalancer: servicesStack.loadBalancer,
// });

// app.synth();
