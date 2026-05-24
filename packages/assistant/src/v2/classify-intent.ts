import type { IntentCentroid, IntentPrediction } from "./types.ts";

function cosineSimilarity(a: number[], b: number[]): number {
	let dot = 0;
	let normA = 0;
	let normB = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i]! * b[i]!;
		normA += a[i]! * a[i]!;
		normB += b[i]! * b[i]!;
	}
	const denom = Math.sqrt(normA) * Math.sqrt(normB);
	return denom === 0 ? 0 : dot / denom;
}

export function classifyIntent(
	queryVector: number[],
	centroids: IntentCentroid[],
	topN = 3,
): IntentPrediction[] {
	const scored = centroids.map((c) => ({
		intent: c.intent,
		dsl_signature: c.dsl_signature,
		confidence: cosineSimilarity(queryVector, c.embedding),
	}));

	scored.sort((a, b) => b.confidence - a.confidence);

	return scored.slice(0, topN);
}
