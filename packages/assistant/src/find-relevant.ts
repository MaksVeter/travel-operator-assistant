import type { DslChunk, EmbeddingService, SearchClient, ScoredChunk } from "core";

export async function findRelevantChunks(
	searchClient: SearchClient,
	embeddingService: EmbeddingService,
	indexName: string,
	query: string,
	topK: number,
	debugSteps?: string[],
): Promise<ScoredChunk[]> {
	const vector = await embeddingService.embed(query);
	debugSteps?.push("Query embedding ready.");
	const chunks = await searchClient.knnSearch<DslChunk>(
		indexName,
		vector,
		topK,
	);
	debugSteps?.push("Chunk search ready.");
	return chunks;
}
