import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { PROJECT_PREFIX, stages } from "./config.ts";
import { AssistantStack } from "./stacks/assistant-stack.ts";
import { IndexerStack } from "./stacks/indexer-stack.ts";
import { OpenSearchStack } from "./stacks/opensearch-stack.ts";

const app = new cdk.App();
const stage = app.node.tryGetContext("stage") ?? "dev";
const stageConfig = stages[stage];

if (!stageConfig) {
	throw new Error(`Unknown stage: ${stage}`);
}

const env = {
	account: stageConfig.account || process.env.CDK_DEFAULT_ACCOUNT,
	region: stageConfig.region || process.env.CDK_DEFAULT_REGION,
};

const collectionName = `${PROJECT_PREFIX}-${stage}`;

// Role ARN patterns for data access policy -- constructed from known naming convention
const accountId = env.account ?? cdk.Aws.ACCOUNT_ID;
const indexerRoleArn = `arn:aws:iam::${accountId}:role/${PROJECT_PREFIX}-${stage}-indexer-role`;
const assistantRoleArn = `arn:aws:iam::${accountId}:role/${PROJECT_PREFIX}-${stage}-assistant-role`;

const opensearchStack = new OpenSearchStack(
	app,
	"TravelAssistantOpenSearch",
	{
		stage,
		collectionName,
		dataAccessPrincipalArns: [indexerRoleArn, assistantRoleArn],
		env,
		description: `Travel Assistant OpenSearch Serverless - ${stage}`,
	},
);

const indexerStack = new IndexerStack(app, "TravelAssistantIndexer", {
	stage,
	collectionEndpoint: opensearchStack.collectionEndpoint,
	collectionArn: opensearchStack.collectionArn,
	env,
	description: `Travel Assistant Indexer Lambda - ${stage}`,
});
indexerStack.addDependency(opensearchStack);

const assistantStack = new AssistantStack(app, "TravelAssistantApi", {
	stage,
	collectionEndpoint: opensearchStack.collectionEndpoint,
	collectionArn: opensearchStack.collectionArn,
	env,
	description: `Travel Assistant API - ${stage}`,
});
assistantStack.addDependency(opensearchStack);
