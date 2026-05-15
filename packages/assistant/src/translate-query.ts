import {
	type AppConfig,
	EmbeddingService,
	LlmService,
	SearchClient,
	log,
	truncateQueryToMaxTokens,
} from "core";
import { assemblePrompt } from "./assemble-prompt.ts";
import { findRelevantChunks } from "./find-relevant.ts";

export type TranslateQueryResult = {
	command: string;
	truncated: boolean;
	/** English step labels; only set when debug mode is on */
	debug?: string[];
};

export type TranslateQueryOptions = {
	debug?: boolean;
};

export async function translateQuery(
	query: string,
	config: AppConfig,
	options?: TranslateQueryOptions,
): Promise<TranslateQueryResult> {
	const debugSteps = options?.debug ? [] as string[] : undefined;

	const { text: boundedQuery, truncated } = truncateQueryToMaxTokens(
		query,
		config.maxQueryTokens,
	);
	if (truncated) {
		log.warn(
			`Query truncated to ~${config.maxQueryTokens} tokens (approx) for embedding`,
		);
		debugSteps?.push(
			"Query truncated to max token budget (approx).",
		);
	}
	log.info(`Translating query: "${boundedQuery}"`);

	const embedder = new EmbeddingService(
		config.awsRegion,
		config.embeddingModel,
		config.embeddingDimensions,
	);
	const search = new SearchClient(config.opensearchEndpoint, config.awsRegion);
	const llm = new LlmService(config.llmRegion, config.llmModel);

	const chunks = await findRelevantChunks(
		search,
		embedder,
		config.opensearchIndex,
		boundedQuery,
		config.retrievalTopK,
		debugSteps,
	);

	log.info(`Found ${chunks.length} relevant chunks`);
	log.debug(
		"Chunks:",
		chunks.map((c) => ({
			intent: c.source.intent,
			score: c.score,
			signature: c.source.dsl_signature,
		})),
	);

	const prompt = assemblePrompt(chunks, boundedQuery);
	debugSteps?.push("Prompt assembled.");
	log.debug("Prompt:", prompt);

	const command = await llm.complete(prompt);
	debugSteps?.push("LLM response received.");
	log.info(`Generated command: ${command}`);

	return {
		command,
		truncated,
		...(debugSteps ? { debug: debugSteps } : {}),
	};
}
