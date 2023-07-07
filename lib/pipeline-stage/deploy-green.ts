import {
  aws_codepipeline as codepipeline,
  aws_codepipeline_actions as actions,
  aws_iam as iam,
  aws_logs as logs,
  aws_s3 as s3,
  aws_stepfunctions as sfn,
  RemovalPolicy,
  ScopedAws,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { IWorkload } from '../workload';

export interface DeployGreenProps {
  projectBaseName: string;
  artifactBucket: s3.IBucket;
  workload: IWorkload;
  prepareDeployGreenOutput: codepipeline.Artifact;
}

export class DeployGreen {

  public readonly output: codepipeline.Artifact;
  public readonly action: actions.StepFunctionInvokeAction;

  constructor (scope: Construct, props: DeployGreenProps){

    const PROJECT_BASE_NAME = props.projectBaseName;
    const artifactBucket = props.artifactBucket;
    const ecsCluster = props.workload.ecsCluster;
    const ecsService = props.workload.ecsService;
    const prodListener = props.workload.prodListener;
    const prodListenerRule = props.workload.prodListenerRule;
    const testListener = props.workload.testListener;
    const testListenerRule = props.workload.testListenerRule;
    const ecsTaskRole = props.workload.ecsTaskRole;
    const ecsTaskExecutionRole = props.workload.ecsTaskExecutionRole;
    const prepareDeployGreenOutput = props.prepareDeployGreenOutput;

    const {
      accountId,
      partition,
      region,
    } = new ScopedAws(scope);

    // -----------------------------
    // Deploy Green Env
    // -----------------------------
    const projectName = `${PROJECT_BASE_NAME}-DeployGreen`;

    // LogGroup for Step Functions
    const logGroup = new logs.LogGroup(scope, 'LogsDeployGreen', {
      logGroupName: `/aws/statemachine/${projectName}`,
      removalPolicy: RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.THREE_MONTHS
    });

    // IAM Policy for Step Functions
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
          ],
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'ecs:DescribeServices',
          ],
          resources: [
            ecsService.serviceArn,
          ],
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'ecs:CreateTaskSet',
          ],
          resources: ['*'],
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'ecs:DeleteTaskSet',
          ],
          resources: [
            `arn:${partition}:ecs:${region}:${accountId}:task-set/${ecsCluster.clusterName}/${ecsService.serviceName}/*`,
          ],
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'elasticloadbalancing:CreateTargetGroup',
            'elasticloadbalancing:DeleteTargetGroup',
          ],
          resources: [
            `arn:${partition}:elasticloadbalancing:${region}:${accountId}:targetgroup/tg-*/*`,
          ],
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'elasticloadbalancing:ModifyRule',
          ],
          resources: [
            prodListener.listenerArn,
            prodListenerRule.listenerRuleArn,
            testListener.listenerArn,
            testListenerRule.listenerRuleArn,
          ],
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'iam:PassRole',
          ],
          resources: [
            ecsTaskRole.roleArn,
            ecsTaskExecutionRole.roleArn,
          ],
        }),
      ]
    });
    // IAM Role for Step Functions
    const role = new iam.Role(scope, 'RoleDeployGreen', {
      assumedBy: new iam.ServicePrincipal('states.amazonaws.com'),
      description: `Role for Step Functions of ${PROJECT_BASE_NAME}`,
      inlinePolicies: {
        'policy': policyDocument,
      },
    });

    // Step Functions State Machine
    const stateMachine = new sfn.StateMachine(scope, 'StateMachineDeployGreen', {
      definitionBody: sfn.DefinitionBody.fromFile('./assets/state-machine/deploy-green.asl.json', {}),
      role: role,
      logs: {
        destination: logGroup,
        includeExecutionData: true,
        level: sfn.LogLevel.ALL
      }
    });

    // Artifact
    const output = new codepipeline.Artifact('DeployGreen');

    // Action
    const action = new actions.StepFunctionInvokeAction({
      actionName: 'Deploy-Green',
      stateMachine: stateMachine,
      stateMachineInput: actions.StateMachineInput.filePath({
        artifact: prepareDeployGreenOutput,
        fileName: '',
        location: 'statemachine-input.json',
      }),
      output: output,
    });

    this.output = output;
    this.action = action;
  }
}