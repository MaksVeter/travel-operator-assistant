import type { DslChunk, ScoredChunk } from "core";

export type V2Config = {
	retrievalTopK: number;
	contextLimit: number;
	scoreThreshold: number;
	intentConfidenceThreshold: number;
	enableRetry: boolean;
};

export type IntentPrediction = {
	intent: string;
	confidence: number;
	dsl_signature: string;
};

export type V2DebugInfo = {
	rewrittenQuery: string;
	retrievedChunks: { intent: string; score: number; dsl_signature: string }[];
	predictedIntents: IntentPrediction[] | null;
	contextAfterFiltering: string[];
	finalPrompt: { system: string; user: string };
	rawLlmOutput: string;
	validationApplied: boolean;
	latencyMs: {
		rewrite: number;
		embed: number;
		search: number;
		intent: number;
		filter: number;
		llm: number;
		total: number;
	};
	refusalReason?: string;
};

export type TranslateQueryV2Result = {
	command: string;
	truncated: boolean;
	debug?: V2DebugInfo;
};

export type TranslateQueryV2Options = {
	debug?: boolean;
	sessionId?: string;
	history?: Array<{ query: string; command: string }>;
};

export type IntentCentroid = {
	intent: string;
	category: string;
	dsl_signature: string;
	embedding: number[];
};
