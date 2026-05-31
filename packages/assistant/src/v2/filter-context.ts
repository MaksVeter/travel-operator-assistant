import type { ScoredChunk } from "core";
import type { IntentPrediction } from "./types.ts";
import { isInitialFlightAvailabilityQuery } from "./query-heuristics.ts";

export type FilterOptions = {
	scoreThreshold: number;
	contextLimit: number;
	intentConfidenceThreshold: number;
	query?: string;
};

const INITIAL_FLIGHT_AVAILABILITY_INTENT = "request_flight_availability";

/**
 * Filters and ranks retrieved chunks using:
 * 1. Score threshold — drop low-relevance chunks
 * 2. Intent boost — boost chunks matching predicted intent (high confidence only)
 * 3. Dedup by intent — keep only best-scoring chunk per intent
 * 4. Query-aware pin — keep initial flight availability chunk when query matches
 * 5. Limit — return at most contextLimit chunks
 */
export function filterContext(
	chunks: ScoredChunk[],
	predictedIntents: IntentPrediction[] | null,
	options: FilterOptions,
): ScoredChunk[] {
	const { scoreThreshold, contextLimit, intentConfidenceThreshold, query } =
		options;

	// 1. Score threshold
	let filtered = chunks.filter((c) => c.score >= scoreThreshold);

	if (filtered.length === 0 && chunks.length > 0) {
		filtered = [chunks[0]!];
	}

	// 2. Intent boost — only when classifier is confident
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

	scored.sort((a, b) => b.effectiveScore - a.effectiveScore);

	// 3. Dedup by intent
	const seenIntents = new Set<string>();
	const deduped: ScoredChunk[] = [];

	for (const { chunk } of scored) {
		if (seenIntents.has(chunk.source.intent)) continue;
		seenIntents.add(chunk.source.intent);
		deduped.push(chunk);
	}

	let result = deduped.slice(0, contextLimit);

	// 4. Pin initial flight availability when query looks like a new search
	if (query && isInitialFlightAvailabilityQuery(query)) {
		const availabilityChunk = chunks.find(
			(c) => c.source.intent === INITIAL_FLIGHT_AVAILABILITY_INTENT,
		);
		if (
			availabilityChunk &&
			!result.some((c) => c.source.intent === INITIAL_FLIGHT_AVAILABILITY_INTENT)
		) {
			result = [availabilityChunk, ...result].slice(0, contextLimit);
		}
	}

	return result;
}
