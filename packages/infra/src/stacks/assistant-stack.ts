import * as path from "node:path";
import * as cdk from "aws-cdk-lib";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import type { Construct } from "constructs";
import { PROJECT_PREFIX } from "../config.ts";

export interface AssistantStackProps extends cdk.StackProps {
	stage: string;
	collectionEndpoint: string;
	collectionArn: string;
}

export class AssistantStack extends cdk.Stack {
	public readonly lambdaRole: iam.Role;

	constructor(scope: Construct, id: string, props: AssistantStackProps) {
		super(scope, id, props);

		const { stage, collectionEndpoint, collectionArn } = props;

		this.lambdaRole = new iam.Role(this, "AssistantRole", {
			roleName: `${PROJECT_PREFIX}-${stage}-assistant-role`,
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
				actions: ["bedrock:InvokeModel", "bedrock:GetInferenceProfile"],
				resources: [
					"arn:aws:bedrock:*::foundation-model/*",
					"arn:aws:bedrock:*:*:inference-profile/*",
				],
			}),
		);

		// First-time Bedrock models sold via AWS Marketplace need these on the caller
		// (auto-subscription). After the model is enabled for the account, invocations work without repeating Subscribe.
		this.lambdaRole.addToPolicy(
			new iam.PolicyStatement({
				sid: "AwsMarketplaceBedrockSubscriptions",
				actions: [
					"aws-marketplace:Subscribe",
					"aws-marketplace:Unsubscribe",
					"aws-marketplace:ViewSubscriptions",
				],
				resources: ["*"],
			}),
		);

		const assistantLogGroup = new logs.LogGroup(
			this,
			"AssistantFunctionLogGroup",
			{
				logGroupName: `/aws/lambda/${PROJECT_PREFIX}-${stage}-assistant`,
				retention: logs.RetentionDays.ONE_WEEK,
				removalPolicy: cdk.RemovalPolicy.DESTROY,
			},
		);

		const fn = new NodejsFunction(this, "AssistantFunction", {
			functionName: `${PROJECT_PREFIX}-${stage}-assistant`,
			runtime: lambda.Runtime.NODEJS_20_X,
			entry: path.join(
				__dirname,
				"..",
				"..",
				"..",
				"..",
				"packages",
				"assistant",
				"src",
				"handler.ts",
			),
			handler: "handler",
			role: this.lambdaRole,
			timeout: cdk.Duration.seconds(60),
			memorySize: 1024,
			bundling: {
				minify: false,
				sourceMap: true,
				target: "node20",
				externalModules: ["@aws-sdk/*"],
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
				LLM_MODEL:
					process.env.LLM_MODEL ??
					"anthropic.claude-3-haiku-20240307-v1:0",
				LLM_REGION: process.env.LLM_REGION ?? this.region,
				RETRIEVAL_TOP_K: process.env.RETRIEVAL_TOP_K ?? "3",
				MAX_QUERY_TOKENS: process.env.MAX_QUERY_TOKENS ?? "4000",
				ASSISTANT_DEBUG: process.env.ASSISTANT_DEBUG ?? "0",
				LOG_LEVEL: process.env.LOG_LEVEL ?? "info",
				V2_RETRIEVAL_TOP_K: process.env.V2_RETRIEVAL_TOP_K ?? "6",
				V2_CONTEXT_LIMIT: process.env.V2_CONTEXT_LIMIT ?? "6",
				V2_SCORE_THRESHOLD: process.env.V2_SCORE_THRESHOLD ?? "0",
				V2_INTENT_CONFIDENCE_THRESHOLD:
					process.env.V2_INTENT_CONFIDENCE_THRESHOLD ?? "0.6",
				V2_ENABLE_RETRY: process.env.V2_ENABLE_RETRY ?? "true",
			},
			logGroup: assistantLogGroup,
		});

		const api = new apigateway.RestApi(this, "AssistantApi", {
			restApiName: `${PROJECT_PREFIX}-${stage}-api`,
			description: `Travel Operator Assistant API - ${stage}`,
			deployOptions: {
				stageName: stage,
				throttlingRateLimit: 10,
				throttlingBurstLimit: 20,
			},
			defaultCorsPreflightOptions: {
				allowOrigins: ["*"],
				allowMethods: ["GET", "POST", "OPTIONS"],
				allowHeaders: ["Content-Type", "X-Assistant-Debug"],
			},
		});

		const translateResource = api.root.addResource("translate");
		translateResource.addMethod(
			"POST",
			new apigateway.LambdaIntegration(fn),
		);

		const v2Resource = api.root.addResource("v2");
		const v2TranslateResource = v2Resource.addResource("translate");
		v2TranslateResource.addMethod(
			"POST",
			new apigateway.LambdaIntegration(fn),
		);

		const healthResource = api.root.addResource("health");
		healthResource.addMethod(
			"GET",
			new apigateway.LambdaIntegration(fn),
		);

		new cdk.CfnOutput(this, "ApiEndpoint", {
			value: api.url ?? "N/A",
			exportName: `${PROJECT_PREFIX}-${stage}-api-endpoint`,
		});

		new cdk.CfnOutput(this, "AssistantRoleArn", {
			value: this.lambdaRole.roleArn,
			exportName: `${PROJECT_PREFIX}-${stage}-assistant-role-arn`,
		});
	}
}
