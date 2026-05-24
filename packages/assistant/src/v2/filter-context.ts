import type { ScoredChunk } from "core";
import type { IntentPrediction } from "./types.ts";

export type FilterOptions = {
	scoreThreshold: number;
	contextLimit: number;
	intentConfidenceThreshold: number;
};

/**
 * Filters and ranks retrieved chunks using:
 * 1. Score threshold — drop low-relevance chunks
 * 2. Intent boost — boost chunks matching predicted intent
 * 3. Dedup by intent — keep only best-scoring chunk per intent
 * 4. Limit — return at most contextLimit chunks
 */
export function filterContext(
	chunks: ScoredChunk[],
	predictedIntents: IntentPrediction[] | null,
	options: FilterOptions,
): ScoredChunk[] {
	const { scoreThreshold, contextLimit, intentConfidenceThreshold } = options;

	// 1. Score threshold
	let filtered = chunks.filter((c) => c.score >= scoreThreshold);

	// If everything is filtered out, keep top chunk regardless
	if (filtered.length === 0 && chunks.length > 0) {
		filtered = [chunks[0]!];
	}

	// 2. Intent boost — only apply if top predicted intent confidence exceeds threshold
	const topConfidence = predictedIntents?.[0]?.confidence ?? 0;
	const topIntent =
		topConfidence >= intentConfidenceThreshold
			? predictedIntents![0]!.intent
			: null;

	const scored = filtered.map((chunk) => {
		const intentMatch = topIntent && chunk.source.intent === topIntent;
		const boostFactor = intentMatch ? 1.5 : 1.0;
		return { chunk, effectiveScore: chunk.score * boostFactor };
	});

	// Sort by effective score descending
	scored.sort((a, b) => b.effectiveScore - a.effectiveScore);

	// 3. Dedup by intent — keep only the best chunk per intent
	const seenIntents = new Set<string>();
	const deduped: ScoredChunk[] = [];

	for (const { chunk } of scored) {
		if (seenIntents.has(chunk.source.intent)) continue;
		seenIntents.add(chunk.source.intent);
		deduped.push(chunk);
	}

	// 4. Limit
	return deduped.slice(0, contextLimit);
}
