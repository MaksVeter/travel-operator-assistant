import * as cdk from "aws-cdk-lib";
import * as opensearchserverless from "aws-cdk-lib/aws-opensearchserverless";
import type { Construct } from "constructs";
import { PROJECT_PREFIX } from "../config.ts";

export interface OpenSearchStackProps extends cdk.StackProps {
	stage: string;
	collectionName: string;
	dataAccessPrincipalArns: string[];
}

export class OpenSearchStack extends cdk.Stack {
	public readonly collectionEndpoint: string;
	public readonly collectionArn: string;
	public readonly collectionName: string;

	constructor(scope: Construct, id: string, props: OpenSearchStackProps) {
		super(scope, id, props);

		const { collectionName, dataAccessPrincipalArns } = props;
		this.collectionName = collectionName;

		const encryptionPolicy = new opensearchserverless.CfnSecurityPolicy(
			this,
			"EncryptionPolicy",
			{
				name: `${collectionName}-enc`,
				type: "encryption",
				policy: JSON.stringify({
					Rules: [
						{
							ResourceType: "collection",
							Resource: [`collection/${collectionName}`],
						},
					],
					AWSOwnedKey: true,
				}),
			},
		);

		const networkPolicy = new opensearchserverless.CfnSecurityPolicy(
			this,
			"NetworkPolicy",
			{
				name: `${collectionName}-net`,
				type: "network",
				policy: JSON.stringify([
					{
						Rules: [
							{
								ResourceType: "collection",
								Resource: [`collection/${collectionName}`],
							},
							{
								ResourceType: "dashboard",
								Resource: [`collection/${collectionName}`],
							},
						],
						AllowFromPublic: true,
					},
				]),
			},
		);

		const collection = new opensearchserverless.CfnCollection(
			this,
			"Collection",
			{
				name: collectionName,
				type: "VECTORSEARCH",
				description: `${PROJECT_PREFIX} DSL knowledge base`,
			},
		);
		collection.addDependency(encryptionPolicy);
		collection.addDependency(networkPolicy);

		this.collectionEndpoint = collection.attrCollectionEndpoint;
		this.collectionArn = collection.attrArn;

		if (dataAccessPrincipalArns.length > 0) {
			new opensearchserverless.CfnAccessPolicy(this, "DataAccessPolicy", {
				name: `${collectionName}-access`,
				type: "data",
				policy: JSON.stringify([
					{
						Rules: [
							{
								ResourceType: "index",
								Resource: [`index/${collectionName}/*`],
								Permission: [
									"aoss:*",
								],
							},
							{
								ResourceType: "collection",
								Resource: [`collection/${collectionName}`],
								Permission: [
									"aoss:*",
								],
							},
						],
						Principal: dataAccessPrincipalArns,
					},
				]),
			});
		}

		new cdk.CfnOutput(this, "CollectionEndpoint", {
			value: collection.attrCollectionEndpoint,
			exportName: `${PROJECT_PREFIX}-${props.stage}-collection-endpoint`,
		});

		new cdk.CfnOutput(this, "CollectionArn", {
			value: collection.attrArn,
			exportName: `${PROJECT_PREFIX}-${props.stage}-collection-arn`,
		});
	}
}
