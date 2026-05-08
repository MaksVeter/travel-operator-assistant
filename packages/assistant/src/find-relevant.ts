import type { DslChunk, EmbeddingService, SearchClient, ScoredChunk } from "core";

export async function findRelevantChunks(
	searchClient: SearchClient,
	embeddingService: EmbeddingService,
	indexName: string,
	query: string,
	topK: number,
): Promise<ScoredChunk[]> {
	const vector = await embeddingService.embed(query);
	return searchClient.knnSearch<DslChunk>(indexName, vector, topK);
}
