import {
  aws_codebuild as codebuild,
  aws_codecommit as codecommit,
  aws_codepipeline as codepipeline,
  aws_codepipeline_actions as actions,
  aws_ecr as ecr,
  aws_iam as iam,
  aws_logs as logs,
  aws_s3 as s3,
  Duration,
  RemovalPolicy,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';

export interface BuildImageProps {
  projectBaseName: string;
  artifactBucket: s3.IBucket;
  repository: codecommit.IRepository;
  ecrRepository: ecr.IRepository;
  sourceOutput: codepipeline.Artifact;
  buildAppOutput: codepipeline.Artifact;
}

export class BuildImage {

  public readonly output: codepipeline.Artifact;
  public readonly action: actions.CodeBuildAction;

  constructor (scope: Construct, props: BuildImageProps){

    const PROJECT_BASE_NAME = props.projectBaseName;
    const artifactBucket = props.artifactBucket;
    const repository = props.repository;
    const ecrRepository = props.ecrRepository;
    const sourceOutput = props.sourceOutput;
    const buildAppOutput = props.buildAppOutput;

    // -----------------------------
    // CodeBuild (Image)
    // -----------------------------
    const projectName = `${PROJECT_BASE_NAME}-Image`;

    // LogGroup for CodeBuild
    const logGroup = new logs.LogGroup(scope, 'LogsBuildImage', {
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
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'ecr:CompleteLayerUpload',
            'ecr:UploadLayerPart',
            'ecr:InitiateLayerUpload',
            'ecr:BatchCheckLayerAvailability',
            'ecr:PutImage'
          ],
          resources: [
            ecrRepository.repositoryArn
          ]
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'ecr:GetAuthorizationToken'
          ],
          resources: [
            '*'
          ]
        }),
      ]
    });
    // IAM Role for CodeBuild
    const role = new iam.Role(scope, 'RoleBuildImage', {
      assumedBy: new iam.ServicePrincipal('codebuild.amazonaws.com'),
      description: `Role for CodeBuild of ${PROJECT_BASE_NAME}`,
      inlinePolicies: {
        'policy': policyDocument
      },
    });

    // BuildProject
    const project = new codebuild.PipelineProject(scope, 'ProjectBuildImage', {
      projectName: projectName,
      buildSpec: codebuild.BuildSpec.fromSourceFilename('buildspec-image.yml'),
      environment: {
        buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_3,
        computeType: codebuild.ComputeType.SMALL,
        privileged: true,
        environmentVariables: {
          'IMAGE_REPO_NAME': {
            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            value: ecrRepository.repositoryName,
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
    const output = new codepipeline.Artifact('BuildImage');

    // Action
    const action = new actions.CodeBuildAction({
      actionName: 'CodeBuild-Image',
      project: project,
      input: sourceOutput,
      extraInputs: [ buildAppOutput ],
      outputs: [ output ],
    });

    this.output = output;
    this.action = action;
  }
}