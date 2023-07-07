#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { EcsExternalDeployControllerStack } from '../lib/stack';

const app = new cdk.App();

const stack = new EcsExternalDeployControllerStack(app, 'EcsExternalDeployController');
