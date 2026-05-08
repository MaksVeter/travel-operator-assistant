export type StageConfig = {
	account: string;
	region: string;
};

export const stages: Record<string, StageConfig> = {
	dev: {
		account: process.env.CDK_DEFAULT_ACCOUNT ?? "",
		region: process.env.CDK_DEFAULT_REGION ?? "us-east-1",
	},
};

export const PROJECT_PREFIX = "travel-assistant";
