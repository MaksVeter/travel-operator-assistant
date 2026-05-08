import { DEFAULT_MAX_QUERY_TOKENS } from "./query-limits.ts";

export type AppConfig = {
	opensearchEndpoint: string;
	opensearchIndex: string;
	awsRegion: string;
	embeddingModel: string;
	embeddingDimensions: number;
	llmModel: string;
	llmRegion: string;
	retrievalTopK: number;
	forceRecreateIndex: boolean;
	maxQueryTokens: number;
};

function required(key: string): string {
	const value = process.env[key];
	if (!value) throw new Error(`Missing required env variable: ${key}`);
	return value;
}

function optional(key: string, fallback: string): string {
	return process.env[key] ?? fallback;
}

function optionalInt(key: string, fallback: number): number {
	const raw = process.env[key];
	if (!raw) return fallback;
	const parsed = Number.parseInt(raw, 10);
	return Number.isNaN(parsed) ? fallback : parsed;
}

function optionalBool(key: string, fallback: boolean): boolean {
	const raw = process.env[key];
	if (!raw) return fallback;
	return raw === "true" || raw === "1";
}

export function loadConfig(): AppConfig {
	return {
		opensearchEndpoint: required("OPENSEARCH_ENDPOINT"),
		opensearchIndex: optional("OPENSEARCH_INDEX", "dsl-commands"),
		awsRegion:
			process.env.AWS_REGION ??
			process.env.AWS_REGION_KEY ??
			process.env.AWS_DEFAULT_REGION ??
			"us-east-1",
		embeddingModel: optional("EMBEDDING_MODEL", "amazon.titan-embed-text-v2:0"),
		embeddingDimensions: optionalInt("EMBEDDING_DIMENSIONS", 1024),
		llmModel: optional("LLM_MODEL", "anthropic.claude-3-haiku-20240307-v1:0"),
		llmRegion: optional("LLM_REGION", optional("AWS_REGION", "us-east-1")),
		retrievalTopK: optionalInt("RETRIEVAL_TOP_K", 3),
		forceRecreateIndex: optionalBool("FORCE_RECREATE_INDEX", false),
		maxQueryTokens: optionalInt("MAX_QUERY_TOKENS", DEFAULT_MAX_QUERY_TOKENS),
	};
}
