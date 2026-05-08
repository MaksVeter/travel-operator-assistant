import { type AppConfig, EmbeddingService, SearchClient, log } from "core";
import type { DslChunk, IndexedChunk } from "core";
import { buildIndexMapping } from "./index-mapping.ts";

export async function runIndexing(
	config: AppConfig,
	chunks: DslChunk[],
): Promise<void> {
	const { opensearchEndpoint, opensearchIndex, awsRegion } = config;

	log.info(`Starting indexing: ${chunks.length} chunks -> ${opensearchIndex}`);

	const embedder = new EmbeddingService(
		awsRegion,
		config.embeddingModel,
		config.embeddingDimensions,
	);
	const search = new SearchClient(opensearchEndpoint, awsRegion);

	// 1. Generate embeddings
	log.info("Generating embeddings...");
	const texts = chunks.map((c) => c.text_for_embedding);
	const embeddings = await embedder.embedBatch(texts);
	log.info(`Generated ${embeddings.length} embeddings`);

	// 2. Handle index lifecycle
	const exists = await search.indexExists(opensearchIndex);

	if (exists && config.forceRecreateIndex) {
		await search.deleteIndex(opensearchIndex);
	}

	if (!exists || config.forceRecreateIndex) {
		const mapping = buildIndexMapping(config.embeddingDimensions);
		await search.createIndex(opensearchIndex, mapping);
	} else {
		log.info(`Index ${opensearchIndex} already exists, appending data`);
	}

	// 3. Prepare documents
	const documents: IndexedChunk[] = chunks.map((chunk, i) => ({
		...chunk,
		command_type: chunk.type,
		embedding: embeddings[i]!,
	}));

	// 4. Bulk index
	log.info("Indexing documents...");
	const result = await search.bulkIndex(
		opensearchIndex,
		documents as unknown as Record<string, unknown>[],
	);
	log.info(
		`Indexing complete: ${result.successful} successful, ${result.failed} failed`,
	);
}
