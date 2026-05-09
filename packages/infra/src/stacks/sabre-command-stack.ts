import * as path from "node:path";
import * as cdk from "aws-cdk-lib";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import type { Construct } from "constructs";
import { PROJECT_PREFIX } from "../config.ts";

export interface SabreCommandStackProps extends cdk.StackProps {
	stage: string;
}

export class SabreCommandStack extends cdk.Stack {
	constructor(scope: Construct, id: string, props: SabreCommandStackProps) {
		super(scope, id, props);

		const { stage } = props;

		const lambdaRole = new iam.Role(this, "SabreCommandRole", {
			roleName: `${PROJECT_PREFIX}-${stage}-sabre-command-role`,
			assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
			managedPolicies: [
				iam.ManagedPolicy.fromAwsManagedPolicyName(
					"service-role/AWSLambdaBasicExecutionRole",
				),
			],
		});

		const sabreLogGroup = new logs.LogGroup(this, "SabreCommandFunctionLogGroup", {
			logGroupName: `/aws/lambda/${PROJECT_PREFIX}-${stage}-sabre-command`,
			retention: logs.RetentionDays.ONE_WEEK,
			removalPolicy: cdk.RemovalPolicy.DESTROY,
		});

		const fn = new NodejsFunction(this, "SabreCommandFunction", {
			functionName: `${PROJECT_PREFIX}-${stage}-sabre-command`,
			runtime: lambda.Runtime.NODEJS_20_X,
			entry: path.join(
				__dirname,
				"..",
				"..",
				"..",
				"..",
				"packages",
				"sabre-command",
				"src",
				"handler.ts",
			),
			handler: "handler",
			role: lambdaRole,
			timeout: cdk.Duration.seconds(60),
			memorySize: 512,
			bundling: {
				minify: false,
				sourceMap: true,
				target: "node20",
				externalModules: ["@aws-sdk/*"],
			},
			environment: {
				SABRE_SOAP_URL:
					process.env.SABRE_SOAP_URL ??
					"https://webservices.cert.platform.sabre.com/websvc",
				SABRE_USERNAME: process.env.SABRE_USERNAME ?? "",
				SABRE_PASSWORD: process.env.SABRE_PASSWORD ?? "",
				SABRE_ORGANIZATION: process.env.SABRE_ORGANIZATION ?? "",
				SABRE_PSEUDO_CITY_CODE: process.env.SABRE_PSEUDO_CITY_CODE ?? "",
				SABRE_DOMAIN: process.env.SABRE_DOMAIN ?? "DEFAULT",
				SABRE_PARTY_FROM: process.env.SABRE_PARTY_FROM ?? "99999",
				SABRE_PARTY_TO: process.env.SABRE_PARTY_TO ?? "123123",
				SABRE_COMMAND_VERSION: process.env.SABRE_COMMAND_VERSION ?? "2.0.0",
				LOG_LEVEL: process.env.LOG_LEVEL ?? "info",
			},
			logGroup: sabreLogGroup,
		});

		const api = new apigateway.RestApi(this, "SabreCommandApi", {
			restApiName: `${PROJECT_PREFIX}-${stage}-sabre-api`,
			description: `Sabre host command (LLS) API - ${stage}`,
			deployOptions: {
				stageName: stage,
				throttlingRateLimit: 5,
				throttlingBurstLimit: 10,
			},
			defaultCorsPreflightOptions: {
				allowOrigins: ["*"],
				allowMethods: ["POST", "GET", "OPTIONS"],
				allowHeaders: ["Content-Type"],
			},
		});

		const commandResource = api.root.addResource("command");
		commandResource.addMethod("POST", new apigateway.LambdaIntegration(fn));

		const validateResource = api.root.addResource("validate");
		validateResource.addMethod("POST", new apigateway.LambdaIntegration(fn));

		const healthResource = api.root.addResource("health");
		healthResource.addMethod("GET", new apigateway.LambdaIntegration(fn));

		new cdk.CfnOutput(this, "SabreCommandApiEndpoint", {
			value: api.url ?? "N/A",
			exportName: `${PROJECT_PREFIX}-${stage}-sabre-api-endpoint`,
		});

		new cdk.CfnOutput(this, "SabreCommandFunctionArn", {
			value: fn.functionArn,
			exportName: `${PROJECT_PREFIX}-${stage}-sabre-command-fn-arn`,
		});
	}
}
