import {
  aws_codebuild as codebuild,
  aws_codepipeline as codepipeline,
  aws_codepipeline_actions as actions,
  aws_iam as iam,
  aws_logs as logs,
  aws_s3 as s3,
  Duration,
  RemovalPolicy,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';

export interface PrepareDeployGreenProps {
  projectBaseName: string;
  artifactBucket: s3.IBucket;
  sourceOutput: codepipeline.Artifact;
  workloadParameter: WorkloadParameter;
}

export interface WorkloadParameter {
  ecsClusterName: string;
  ecsServiceName: string;
  prodListenerArn: string;
  prodListenerRuleArn: string;
  testListenerArn: string;
  testListenerRuleArn: string;
  taskDefinition: string;
  containerName: string;
  containerPort: number;
  vpcId: string;
  subnets: string[];
  securityGroups: string[];
}

export class PrepareDeployGreen {

  public readonly output: codepipeline.Artifact;
  public readonly action: actions.CodeBuildAction;

  constructor (scope: Construct, props: PrepareDeployGreenProps){

    const PROJECT_BASE_NAME = props.projectBaseName;
    const artifactBucket = props.artifactBucket;
    const sourceOutput = props.sourceOutput;
    const workloadParameter = props.workloadParameter;

    // -----------------------------
    // CodeBuild (Prepare Deploy Green Input)
    // -----------------------------
    const projectName = `${PROJECT_BASE_NAME}-PrepareDeployGreen`;

    // LogGroup for CodeBuild
    const logGroup = new logs.LogGroup(scope, 'LogsPrepareDeployGreen', {
      logGroupName: `/aws/codebuild/${projectName}`,
      removalPolicy: RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.THREE_MONTHS
    });

    // IAM Policy for CodeBuild
    const policyDocument = new iam.PolicyDocument({
      statements:[
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            's3:PutObject',
            's3:GetBucketAcl',
            's3:GetBucketLocation'
          ],
          resources: [
            artifactBucket.bucketArn,
            `${artifactBucket.bucketArn}/*`
          ]
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'logs:CreateLogGroup',
            'logs:CreateLogStream',
            'logs:PutLogEvents'
          ],
          resources: [
            logGroup.logGroupArn,
            `${logGroup.logGroupArn}:*`
          ]
        }),
      ]
    });
    // IAM Role for CodeBuild
    const role = new iam.Role(scope, 'RolePrepareDeployGreen', {
      assumedBy: new iam.ServicePrincipal('codebuild.amazonaws.com'),
      description: `Role for CodeBuild of ${projectName}`,
      inlinePolicies: {
        'policy': policyDocument
      },
    });

    // BuildProject
    const project = new codebuild.PipelineProject(scope, 'ProjectPrepareDeployGreen', {
      projectName: projectName,
      buildSpec: codebuild.BuildSpec.fromSourceFilename('buildspec-prepare-deploy-green.yml'),
      environment: {
        buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_3,
        computeType: codebuild.ComputeType.SMALL,
        environmentVariables: {
          'clusterName': {
            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            value: workloadParameter.ecsClusterName,
          },
          'serviceName': {
            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            value: workloadParameter.ecsServiceName,
          },
          'prodListenerArn': {
            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            value: workloadParameter.prodListenerArn,
          },
          'prodListenerRuleArn': {
            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            value: workloadParameter.prodListenerRuleArn,
          },
          'testListenerArn': {
            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            value: workloadParameter.testListenerArn,
          },
          'testListenerRuleArn': {
            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            value: workloadParameter.testListenerRuleArn,
          },
          'taskDefinition': {
            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            value: workloadParameter.taskDefinition,
          },
          'containerName': {
            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            value: workloadParameter.containerName,
          },
          'containerPort': {
            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            value: workloadParameter.containerPort,
          },
          'vpcId': {
            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            value: workloadParameter.vpcId,
          },
          'subnets': {
            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            value: workloadParameter.subnets,
          },
          'securityGroups': {
            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            value: workloadParameter.securityGroups,
          },
        }
      },
      logging: {
        cloudWatch: {
          logGroup: logGroup
        }
      },
      role: role,
      timeout: Duration.minutes(30),
      queuedTimeout: Duration.hours(8)
    });

    // Artifact
    const output = new codepipeline.Artifact('PrepareDeployGreen');

    // Action
    const action = new actions.CodeBuildAction({
      actionName: 'CodeBuild-Prepare-Deploy-Green',
      project: project,
      input: sourceOutput,
      outputs: [ output ],
    });

    this.output = output;
    this.action = action;
  }
}