import {
	type AppConfig,
	EmbeddingService,
	LlmService,
	SearchClient,
	log,
} from "core";
import { assemblePrompt } from "./assemble-prompt.ts";
import { findRelevantChunks } from "./find-relevant.ts";

export async function translateQuery(
	query: string,
	config: AppConfig,
): Promise<string> {
	log.info(`Translating query: "${query}"`);

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
		query,
		config.retrievalTopK,
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

	const prompt = assemblePrompt(chunks, query);
	log.debug("Prompt:", prompt);

	const command = await llm.complete(prompt);
	log.info(`Generated command: ${command}`);

	return command;
}
