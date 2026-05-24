import type { DslChunk, EmbeddingService, SearchClient, SearchHit, ScoredChunk } from "core";

const DEFAULT_KNN_WEIGHT = 0.7;
const DEFAULT_BM25_WEIGHT = 0.3;

/**
 * Min-max normalize scores to [0, 1] range.
 * If all scores are equal, returns 1.0 for each.
 */
function normalizeScores<T>(hits: SearchHit<T>[]): { hit: SearchHit<T>; norm: number }[] {
	if (hits.length === 0) return [];
	const scores = hits.map((h) => h.score);
	const min = Math.min(...scores);
	const max = Math.max(...scores);
	const range = max - min;

	return hits.map((hit) => ({
		hit,
		norm: range === 0 ? 1.0 : (hit.score - min) / range,
	}));
}

/**
 * Reciprocal Rank Fusion — merges two ranked lists.
 * RRF score = 1/(k + rank) for each list, summed.
 */
function reciprocalRankFusion<T extends { intent: string }>(
	knnHits: SearchHit<T>[],
	bm25Hits: SearchHit<T>[],
	knnWeight: number,
	bm25Weight: number,
): SearchHit<T>[] {
	const k = 60; // RRF constant
	const scoreMap = new Map<string, { hit: SearchHit<T>; rrfScore: number }>();

	// Score from kNN ranked list
	for (let rank = 0; rank < knnHits.length; rank++) {
		const hit = knnHits[rank]!;
		const key = hit.source.intent;
		const rrfContribution = knnWeight / (k + rank + 1);
		const existing = scoreMap.get(key);
		if (existing) {
			existing.rrfScore += rrfContribution;
		} else {
			scoreMap.set(key, { hit, rrfScore: rrfContribution });
		}
	}

	// Score from BM25 ranked list
	for (let rank = 0; rank < bm25Hits.length; rank++) {
		const hit = bm25Hits[rank]!;
		const key = hit.source.intent;
		const rrfContribution = bm25Weight / (k + rank + 1);
		const existing = scoreMap.get(key);
		if (existing) {
			existing.rrfScore += rrfContribution;
		} else {
			scoreMap.set(key, { hit, rrfScore: rrfContribution });
		}
	}

	// Sort by combined RRF score descending
	const merged = [...scoreMap.values()];
	merged.sort((a, b) => b.rrfScore - a.rrfScore);

	return merged.map((m) => ({
		score: m.rrfScore,
		source: m.hit.source,
	}));
}

export async function findRelevantChunksV2(
	searchClient: SearchClient,
	embeddingService: EmbeddingService,
	indexName: string,
	rewrittenQuery: string,
	topK: number,
	knnWeight = DEFAULT_KNN_WEIGHT,
	bm25Weight = DEFAULT_BM25_WEIGHT,
): Promise<{ chunks: ScoredChunk[]; queryVector: number[] }> {
	const queryVector = await embeddingService.embed(rewrittenQuery);

	// Run kNN and BM25 searches in parallel
	const [knnResults, bm25Results] = await Promise.all([
		searchClient.knnSearch<DslChunk>(indexName, queryVector, topK),
		searchClient.keywordSearch<DslChunk>(indexName, rewrittenQuery, topK),
	]);

	// Merge using Reciprocal Rank Fusion
	const merged = reciprocalRankFusion(
		knnResults,
		bm25Results,
		knnWeight,
		bm25Weight,
	);

	return { chunks: merged.slice(0, topK), queryVector };
}
