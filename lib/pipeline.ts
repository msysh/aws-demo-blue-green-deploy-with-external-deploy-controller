import * as cdk from 'aws-cdk-lib';
import {
  aws_codepipeline as codepipeline,
  aws_codepipeline_actions as actions,
  aws_iam as iam,
  aws_s3 as s3,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';

import { Source } from './pipeline-stage/source';
import { BuildApp } from './pipeline-stage/build-app';
import { BuildImage } from './pipeline-stage/build-image';
import { PrepareDeployGreen } from './pipeline-stage/prepare-deploy-green';
import { DeployGreen } from './pipeline-stage/deploy-green';
import { Swap } from './pipeline-stage/swap';
import { CleanUp } from './pipeline-stage/clean-up';
import { IWorkload } from './workload';

export interface PipelineStackProps {
  workload: IWorkload;
}

export class Pipeline extends Construct {
  constructor(scope: Construct, id: string, props: PipelineStackProps) {
    super(scope, id);

    const PROJECT_BASE_NAME = props.workload.ecsService.serviceName;
    const workload: IWorkload = props.workload;

    // -----------------------------
    // S3 (for Artifact store)
    // -----------------------------
    const artifactBucket = new s3.Bucket(this, 'bucket-artifact');

    const source = new Source(this, {
      projectBaseName: PROJECT_BASE_NAME,
    });

    const buildApp = new BuildApp(this, {
      projectBaseName: PROJECT_BASE_NAME,
      artifactBucket: artifactBucket,
      repository: source.repository,
      sourceOutput: source.output,
    });

    const buildImage = new BuildImage(this, {
      projectBaseName: PROJECT_BASE_NAME,
      artifactBucket: artifactBucket,
      repository: source.repository,
      ecrRepository: workload.ecrRepository,
      sourceOutput: source.output,
      buildAppOutput: buildApp.output,
    });

    const prepareDeployGreen = new PrepareDeployGreen(this, {
      projectBaseName: PROJECT_BASE_NAME,
      artifactBucket: artifactBucket,
      sourceOutput: source.output,
      workloadParameter: {
        ecsClusterName: workload.ecsCluster.clusterName,
        ecsServiceName: workload.ecsService.serviceName,
        prodListenerArn: workload.prodListener.listenerArn,
        prodListenerRuleArn: workload.prodListenerRule.listenerRuleArn,
        testListenerArn: workload.testListener.listenerArn,
        testListenerRuleArn: workload.testListenerRule.listenerRuleArn,
        taskDefinition: workload.taskDefinition.taskDefinitionArn,
        containerName: workload.containerName,
        containerPort: workload.containerPort,
        vpcId: workload.vpc.vpcId,
        subnets: workload.subnetIds,
        securityGroups: workload.securityGroupIds,
      },
    });

    const deployGreen = new DeployGreen(this, {
      projectBaseName: PROJECT_BASE_NAME,
      artifactBucket: artifactBucket,
      workload: props.workload,
      prepareDeployGreenOutput: prepareDeployGreen.output,
    });

    // Approve Swap Action
    const approveSwapAction = new actions.ManualApprovalAction({
      actionName: 'Approve-Swap',
      additionalInformation: 'Please check test env before swap.',
      externalEntityLink: `http://${workload.alb.loadBalancerDnsName}:8080/`
    });

    const swap = new Swap(this, {
      projectBaseName: PROJECT_BASE_NAME,
      artifactBucket: artifactBucket,
      workload: props.workload,
      deployGreenOutput: deployGreen.output,
    });

    // 
    const approveCleanUpAction = new actions.ManualApprovalAction({
      actionName: 'Approve-CleanUp',
      additionalInformation: 'Please check prod env before deleteing previous env.',
      externalEntityLink: `http://${workload.alb.loadBalancerDnsName}/`
    });

    const cleanUp = new CleanUp(this, {
      projectBaseName: PROJECT_BASE_NAME,
      artifactBucket: artifactBucket,
      workload: props.workload,
      swapOutput: swap.output,
    })

    // -----------------------------
    // CodePipeline
    // -----------------------------

    // IAM Role for CodePipeline
    const pipelineRole = new iam.Role(this, 'RoleCodepipeline', {
      assumedBy: new iam.ServicePrincipal('codepipeline.amazonaws.com'),
      description: `Role for CodePipeline of ${PROJECT_BASE_NAME}`,
    });

    // Pipeline
    const pipeline = new codepipeline.Pipeline(this, 'CodePipeline', {
      pipelineName: PROJECT_BASE_NAME,
      artifactBucket: artifactBucket,
      role: pipelineRole,
      stages: [
        {
          stageName: 'Source',
          actions: [ source.action ]
        },
        {
          stageName: 'Build-App',
          actions: [ buildApp.action ]
        },
        {
          stageName: 'Build-Image',
          actions: [ buildImage.action ]
        },
        {
          stageName: 'Prepare-Deploy-Green',
          actions: [ prepareDeployGreen.action ]
        },
        {
          stageName: 'Deploy-Green',
          actions: [ deployGreen.action ]
        },
        {
          stageName: 'Approve-Swap',
          actions: [ approveSwapAction ]
        },
        {
          stageName: 'Swap',
          actions: [ swap.action ]
        },
        {
          stageName: 'Approve-CleanUp',
          actions: [ approveCleanUpAction ]
        },
        {
          stageName: 'CleanUp',
          actions: [ cleanUp.action ]
        }
      ],
    });

    new cdk.CfnOutput(this, 'Output-ArtifactBucketName', {
      description: 'Artifact Bucket Name',
      value: artifactBucket.bucketName,
    });
  }
}