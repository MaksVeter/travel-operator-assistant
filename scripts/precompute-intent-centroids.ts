#!/usr/bin/env bun
/**
 * Precompute intent centroids for V2 intent classification.
 * Each centroid is the embedding of the chunk's `text_for_embedding` field.
 * Since each intent maps to exactly one chunk, the centroid = that chunk's embedding.
 *
 * Usage (from travel-operator-assistant):
 *   bun run scripts/precompute-intent-centroids.ts
 */

import fs from "node:fs";
import path from "node:path";
import { EmbeddingService, loadConfig } from "../packages/core/src/index.ts";

type DslChunk = {
	intent: string;
	type: string;
	text_for_embedding: string;
	dsl_signature: string;
	category: string;
};

type IntentCentroid = {
	intent: string;
	category: string;
	dsl_signature: string;
	embedding: number[];
};

async function main() {
	const config = loadConfig();
	const chunksPath = path.join(process.cwd(), "chunks.json");
	const outputPath = path.join(process.cwd(), "data", "intent-centroids.json");

	const chunks = JSON.parse(fs.readFileSync(chunksPath, "utf8")) as DslChunk[];
	console.log(`Loaded ${chunks.length} chunks from ${chunksPath}`);

	const embedder = new EmbeddingService(
		config.awsRegion,
		config.embeddingModel,
		config.embeddingDimensions,
	);

	const centroids: IntentCentroid[] = [];

	console.log(`Embedding ${chunks.length} texts sequentially with retries...`);

	for (let i = 0; i < chunks.length; i++) {
		const chunk = chunks[i]!;
		let embedding: number[] | null = null;
		for (let attempt = 0; attempt < 3; attempt++) {
			try {
				embedding = await embedder.embed(chunk.text_for_embedding);
				break;
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				console.warn(`  [attempt ${attempt + 1}/3] Failed "${chunk.intent}": ${msg}`);
				if (attempt < 2) await new Promise((r) => setTimeout(r, 1000));
			}
		}
		if (!embedding) {
			throw new Error(`Failed to embed chunk "${chunk.intent}" after 3 attempts`);
		}
		centroids.push({
			intent: chunk.intent,
			category: chunk.category,
			dsl_signature: chunk.dsl_signature,
			embedding,
		});
		if ((i + 1) % 10 === 0) {
			console.log(`  embedded ${i + 1}/${chunks.length}`);
		}
	}

	fs.mkdirSync(path.dirname(outputPath), { recursive: true });
	fs.writeFileSync(outputPath, JSON.stringify(centroids, null, 2), "utf8");
	console.log(`Written ${centroids.length} intent centroids to ${outputPath}`);
}

await main();
