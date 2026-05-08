import * as path from "node:path";
import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import type { Construct } from "constructs";
import { PROJECT_PREFIX } from "../config.ts";

export interface IndexerStackProps extends cdk.StackProps {
	stage: string;
	collectionEndpoint: string;
	collectionArn: string;
}

export class IndexerStack extends cdk.Stack {
	public readonly lambdaRole: iam.Role;

	constructor(scope: Construct, id: string, props: IndexerStackProps) {
		super(scope, id, props);

		const { stage, collectionEndpoint, collectionArn } = props;

		this.lambdaRole = new iam.Role(this, "IndexerRole", {
			roleName: `${PROJECT_PREFIX}-${stage}-indexer-role`,
			assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
			managedPolicies: [
				iam.ManagedPolicy.fromAwsManagedPolicyName(
					"service-role/AWSLambdaBasicExecutionRole",
				),
			],
		});

		this.lambdaRole.addToPolicy(
			new iam.PolicyStatement({
				actions: ["aoss:APIAccessAll"],
				resources: [collectionArn],
			}),
		);

		this.lambdaRole.addToPolicy(
			new iam.PolicyStatement({
				actions: ["bedrock:InvokeModel"],
				resources: ["arn:aws:bedrock:*::foundation-model/*"],
			}),
		);

		const fn = new NodejsFunction(this, "IndexerFunction", {
			functionName: `${PROJECT_PREFIX}-${stage}-indexer`,
			runtime: lambda.Runtime.NODEJS_20_X,
			entry: path.join(
				__dirname,
				"..",
				"..",
				"..",
				"..",
				"indexer",
				"src",
				"handler.ts",
			),
			handler: "handler",
			role: this.lambdaRole,
			timeout: cdk.Duration.minutes(5),
			memorySize: 512,
			bundling: {
				minify: false,
				sourceMap: true,
				target: "node20",
				externalModules: ["@aws-sdk/*"],
				commandHooks: {
					beforeBundling: () => [],
					beforeInstall: () => [],
					afterBundling: (inputDir: string, outputDir: string) => [
						`cp ${inputDir}/chunks.json ${outputDir}/chunks.json`,
					],
				},
			},
			environment: {
				OPENSEARCH_ENDPOINT: collectionEndpoint,
				OPENSEARCH_INDEX:
					process.env.OPENSEARCH_INDEX ?? "dsl-commands",
				AWS_REGION_KEY: this.region,
				EMBEDDING_MODEL:
					process.env.EMBEDDING_MODEL ??
					"amazon.titan-embed-text-v2:0",
				EMBEDDING_DIMENSIONS:
					process.env.EMBEDDING_DIMENSIONS ?? "1024",
				FORCE_RECREATE_INDEX:
					process.env.FORCE_RECREATE_INDEX ?? "false",
				LOG_LEVEL: process.env.LOG_LEVEL ?? "info",
			},
			logRetention: logs.RetentionDays.ONE_WEEK,
		});

		new cdk.CfnOutput(this, "IndexerFunctionArn", {
			value: fn.functionArn,
			exportName: `${PROJECT_PREFIX}-${stage}-indexer-fn-arn`,
		});

		new cdk.CfnOutput(this, "IndexerRoleArn", {
			value: this.lambdaRole.roleArn,
			exportName: `${PROJECT_PREFIX}-${stage}-indexer-role-arn`,
		});
	}
}
