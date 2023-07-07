import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

import { Vpc } from './vpc';
import { Workload } from './workload';
import { Pipeline } from './pipeline';

const ECS_SERVICE_NAME: string = 'external-deploy-controller';

export class EcsExternalDeployControllerStack extends cdk.Stack {

  constructor(scope: Construct, id: string, props?: cdk.StackProps){
    super(scope, id, props);

    const vpc = new Vpc(this, 'Vpc');

    const workload = new Workload(this, 'Workload', {
      vpc: vpc.vpc,
      defaultSecurityGroupId: vpc.defaultSecurityGroupId,
      ecsServiceName: ECS_SERVICE_NAME,
    });

    const pipeline = new Pipeline(this, 'Pipeline', {
      workload: workload
    });
  }
}