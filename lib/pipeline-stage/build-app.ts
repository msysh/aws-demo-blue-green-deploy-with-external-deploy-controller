import {
  aws_codebuild as codebuild,
  aws_codecommit as codecommit,
  aws_codepipeline as codepipeline,
  aws_codepipeline_actions as actions,
  aws_iam as iam,
  aws_logs as logs,
  aws_s3 as s3,
  Duration,
  RemovalPolicy,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';

export interface BuildAppProps {
  projectBaseName: string;
  artifactBucket: s3.IBucket;
  repository: codecommit.IRepository;
  sourceOutput: codepipeline.Artifact;
}

export class BuildApp {

  public readonly output: codepipeline.Artifact;
  public readonly action: actions.CodeBuildAction;

  constructor (scope: Construct, props: BuildAppProps){

    const PROJECT_BASE_NAME = props.projectBaseName;
    const artifactBucket = props.artifactBucket;
    const repository = props.repository;
    const sourceOutput = props.sourceOutput;

    // -----------------------------
    // CodeBuild (App)
    // -----------------------------
    const projectName = `${PROJECT_BASE_NAME}-App`;

    // LogGroup for CodeBuild
    const logGroup = new logs.LogGroup(scope, 'LogsBuildApp', {
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
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'codecommit:GitPull'
          ],
          resources: [
            repository.repositoryArn
          ]
        }),
      ]
    });
    // IAM Role for CodeBuild
    const role = new iam.Role(scope, 'RoleBuildApp', {
      assumedBy: new iam.ServicePrincipal('codebuild.amazonaws.com'),
      description: `Role for CodeBuild of ${projectName}`,
      inlinePolicies: {
        'policy': policyDocument
      },
    });

    // BuildProject
    const project = new codebuild.PipelineProject(scope, 'ProjectBuildApp', {
      projectName: projectName,
      buildSpec: codebuild.BuildSpec.fromSourceFilename('buildspec-app.yml'),
      environment: {
        buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_3,
        computeType: codebuild.ComputeType.SMALL
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
    const output = new codepipeline.Artifact('BuildApp');

    // Action
    const action = new actions.CodeBuildAction({
      actionName: 'CodeBuild-App',
      project: project,
      input: sourceOutput,
      outputs: [ output ],
    });

    this.output = output;
    this.action = action;
  }
}