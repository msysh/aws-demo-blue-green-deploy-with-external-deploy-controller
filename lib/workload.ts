import * as cdk from 'aws-cdk-lib';
import {
  aws_ec2 as ec2,
  aws_ecr as ecr,
  aws_ecs as ecs,
  aws_elasticloadbalancingv2 as elbv2,
  aws_iam as iam,
  aws_logs as logs,
  Duration,
  RemovalPolicy,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';

export interface WorkloadProps {
  ecsServiceName: string;
  vpc: ec2.IVpc;
  defaultSecurityGroupId: string;
}

export interface IWorkload {
  readonly ecrRepository: ecr.IRepository;
  readonly ecsTaskRole: iam.IRole;
  readonly ecsTaskExecutionRole: iam.IRole;
  readonly ecsCluster: ecs.ICluster;
  readonly ecsService: ecs.IService;
  readonly alb: elbv2.IApplicationLoadBalancer;
  readonly prodListener: elbv2.IApplicationListener;
  readonly prodListenerRule: elbv2.ApplicationListenerRule;
  readonly testListener: elbv2.IApplicationListener;
  readonly testListenerRule: elbv2.ApplicationListenerRule;
  readonly taskDefinition: ecs.TaskDefinition;
  readonly containerName: string;
  readonly containerPort: number;
  readonly vpc: ec2.IVpc;
  readonly subnetIds: string[];
  readonly securityGroupIds: string[];
}

export class Workload extends Construct implements IWorkload {

  public readonly ecrRepository: ecr.IRepository;
  public readonly ecsTaskRole: iam.IRole;
  public readonly ecsTaskExecutionRole: iam.IRole;
  public readonly ecsCluster: ecs.ICluster;
  public readonly ecsService: ecs.IService;
  public readonly alb: elbv2.IApplicationLoadBalancer;
  public readonly prodListener: elbv2.IApplicationListener;
  public readonly prodListenerRule: elbv2.ApplicationListenerRule;
  public readonly testListener: elbv2.IApplicationListener;
  public readonly testListenerRule: elbv2.ApplicationListenerRule;
  public readonly taskDefinition: ecs.TaskDefinition;
  public readonly containerName: string;
  public readonly containerPort: number;
  public readonly vpc: ec2.IVpc;
  public readonly subnetIds: string[];
  public readonly securityGroupIds: string[];

  constructor(scope: Construct, id: string, props: WorkloadProps) {
    super(scope, id);

    const ECS_SERVICE_NAME = props.ecsServiceName;

    const vpc: ec2.IVpc = props.vpc;

    // -----------------------------
    // ALB
    // -----------------------------
    const albSecurityGroup = new ec2.SecurityGroup(this, 'SgPublic', {
      vpc: vpc,
      description: 'for ALB',
      securityGroupName: 'security-group-alb'
    });
    albSecurityGroup.addIngressRule(ec2.Peer.ipv4('0.0.0.0/0'), ec2.Port.tcp(80), 'Allow from public');
    albSecurityGroup.addIngressRule(ec2.Peer.ipv4('0.0.0.0/0'), ec2.Port.tcp(8080), 'Allow from public');
    const alb = new elbv2.ApplicationLoadBalancer(this, 'alb', {
      internetFacing: true,
      securityGroup: albSecurityGroup,
      vpc: vpc,
    });
    alb.addSecurityGroup(ec2.SecurityGroup.fromSecurityGroupId(this, 'DefaultSecurityGroupId', props.defaultSecurityGroupId));

    // ALB Listener for Prod
    const prodListener = alb.addListener('AlbProdListener', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      defaultAction: elbv2.ListenerAction.fixedResponse(400, {
        contentType: 'text/plain',
        messageBody: 'Bad Request',
      }),
    });
    const prodListenerRule = new elbv2.ApplicationListenerRule(this, 'ProdListenerRule', {
      listener: prodListener,
      priority: 1,
      action: elbv2.ListenerAction.fixedResponse(503, {
        contentType: 'text/plain',
        messageBody: 'dummy response : please deploy workload',
      }),
      conditions: [
        elbv2.ListenerCondition.pathPatterns(['/*']),
      ]
    });

    // ALB Listener for Test
    const testListener = alb.addListener('AlbTestListener', {
      port: 8080,
      protocol: elbv2.ApplicationProtocol.HTTP,
      defaultAction: elbv2.ListenerAction.fixedResponse(400, {
        contentType: 'text/plain',
        messageBody: 'Bad Request',
      }),
    });
    const testListenerRule = new elbv2.ApplicationListenerRule(this, 'TestListenerRule', {
      listener: testListener,
      priority: 1,
      action: elbv2.ListenerAction.fixedResponse(503, {
        contentType: 'text/plain',
        messageBody: 'dummy response : please deploy workload',
      }),
      conditions: [
        elbv2.ListenerCondition.pathPatterns(['/*']),
      ]
    });

    // -----------------------------
    // IAM Role
    // -----------------------------
    // Task Role
    const taskRolePolicyDocument = new iam.PolicyDocument({
      statements:[
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'ssmmessages:CreateControlChannel',
            'ssmmessages:CreateDataChannel',
            'ssmmessages:OpenControlChannel',
            'ssmmessages:OpenDataChannel',
          ],
          resources: [
            '*'
          ]
        })
      ]
    });
    const taskRole = new iam.Role(this, 'RoleTask', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: `Role for ECS task of ${ECS_SERVICE_NAME}`,
      inlinePolicies: {
        'policy': taskRolePolicyDocument
      },
      roleName: `ecsTaskRole-Service_${ECS_SERVICE_NAME}`
    });

    // Task Execution Role
    const taskExecutionRole = new iam.Role(this, 'RoleTaskExecution', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: `Role for ECS-Agent container of ${ECS_SERVICE_NAME}`,
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy')
      ],
      roleName: `ecsTaskExecutionRole-Service_${ECS_SERVICE_NAME}`
    });

    // ----------
    // Cloud Watch Logs
    // ----------
    const logGroup = new logs.LogGroup(this, 'Logs', {
      logGroupName: `/ecs/${ECS_SERVICE_NAME}`,
      removalPolicy: RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.SIX_MONTHS,
    });

    // ----------
    // ECR
    // ----------
    const repository = new ecr.Repository(this, 'EcrRepository', {
      imageScanOnPush: true,
      lifecycleRules: [
        {
          description: 'Keep the number of images',
          maxImageCount: 1,
          rulePriority: 1
        }
      ],
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // -----------------------------
    // ECS
    // -----------------------------

    // Cluster
    const cluster = new ecs.Cluster(this, 'Cluster', {
      vpc: vpc,
    })

    // Task Definition
    const taskDefinition = new ecs.TaskDefinition(this, 'TaskDefinition', {
      compatibility: ecs.Compatibility.FARGATE,
      family: ECS_SERVICE_NAME,
      taskRole: taskRole,
      executionRole: taskExecutionRole,
      cpu: "256",
      memoryMiB: "512",
    });
    taskDefinition.addContainer('nginx', {
      image: ecs.ContainerImage.fromEcrRepository(repository, "latest"),
      portMappings: [
        {
          protocol: ecs.Protocol.TCP,
          hostPort: 80,
          containerPort: 80,
        }
      ],
      healthCheck: {
        command: ["CMD-SHELL", "curl -f http://localhost:80/ || exit 1" ],
        interval: Duration.seconds(15),
        retries: 3,
        startPeriod: Duration.seconds(10),
        timeout: Duration.seconds(5)
      },
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'nginx',
        logGroup: logGroup
      }),
      readonlyRootFilesystem: false,
      startTimeout: Duration.seconds(2),
      stopTimeout: Duration.seconds(80),
    });

    // Service
    const service = new ecs.FargateService(this, 'EcsService', {
      cluster: cluster,
      taskDefinition: taskDefinition,
      capacityProviderStrategies: [
        {
          capacityProvider: "FARGATE_SPOT",
          base: 0,
          weight: 100
        },
      ],
      deploymentController: {
        type: ecs.DeploymentControllerType.EXTERNAL // ECS: rolling update, CODE_DEPLOY: blue/green
      },
      desiredCount: 0,
      enableECSManagedTags: true,
      enableExecuteCommand: true,
      maxHealthyPercent: 200,
      minHealthyPercent: 100,
      propagateTags: ecs.PropagatedTagSource.TASK_DEFINITION,
      serviceName: ECS_SERVICE_NAME,
    });
    const cfnService = service.node.defaultChild as ecs.CfnService;
    cfnService.addDeletionOverride('Properties.NetworkConfiguration');
    cfnService.addDeletionOverride('Properties.DeploymentConfiguration.Alarms');

    // -----------------------------
    // Output
    // -----------------------------
    new cdk.CfnOutput(this, 'Output-AlbProdDns', {
      description: 'ALB DNS name',
      value: `http://${alb.loadBalancerDnsName}/`,
    });
    new cdk.CfnOutput(this, 'Output-AlbTestDns', {
      description: 'ALB DNS name',
      value: `http://${alb.loadBalancerDnsName}:8080/`,
    });
    new cdk.CfnOutput(this, 'Output-ProdListener', {
      description: 'ALB Listener for Prod',
      value: prodListener.listenerArn,
    });
    new cdk.CfnOutput(this, 'Output-TestListener', {
      description: 'ALB Listener for Test',
      value: testListener.listenerArn,
    });
    new cdk.CfnOutput(this, 'Output-EcsClusterName', {
      description: 'ECS Cluster Name',
      value: cluster.clusterName,
    });
    new cdk.CfnOutput(this, 'Output-EcsServiceName', {
      description: 'ECS Service Name',
      value: service.serviceName,
    });
    new cdk.CfnOutput(this, 'Output-EcrRepositoryUri', {
      description: 'ECR Repository URI',
      value: repository.repositoryUri,
    });

    this.ecrRepository = repository;
    this.ecsTaskRole = taskRole;
    this.ecsTaskExecutionRole = taskExecutionRole;
    this.ecsCluster = cluster;
    this.ecsService = service;
    this.alb = alb;
    this.prodListener = prodListener;
    this.prodListenerRule = prodListenerRule;
    this.testListener = testListener;
    this.testListenerRule = testListenerRule;
    this.taskDefinition = taskDefinition;
    this.containerName = taskDefinition.defaultContainer!.containerName,
    this.containerPort = taskDefinition.defaultContainer!.containerPort,
    this.vpc = vpc;
    this.subnetIds = vpc.privateSubnets.map<string>((subnet) => { return subnet.subnetId });
    this.securityGroupIds = [ props.defaultSecurityGroupId ]
  }
}