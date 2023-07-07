import * as cdk from 'aws-cdk-lib';
import {
  aws_ec2 as ec2,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';

export interface VpcProps{
}

export class Vpc extends Construct {

  public readonly vpc: ec2.IVpc;
  public readonly defaultSecurityGroupId: string;

  constructor(scope: Construct, id: string, props?: VpcProps){
    super(scope, id);

    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      restrictDefaultSecurityGroup: false,
    });

    this.vpc = vpc;
    this.defaultSecurityGroupId = vpc.vpcDefaultSecurityGroup;

    new cdk.CfnOutput(this, 'OutputVpcDefaultSecurityGroup', {
      description: 'VPC Default Security Group',
      value: vpc.vpcDefaultSecurityGroup,
    });
  }
}