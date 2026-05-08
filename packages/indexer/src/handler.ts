import type { Context } from "aws-lambda";
import { loadConfig, log } from "core";
import type { DslChunk } from "core";
import { runIndexing } from "./run-indexing.ts";

import chunksData from "../../../chunks.json";

type IndexerEvent = {
	forceRecreateIndex?: boolean;
};

export async function handler(
	event: IndexerEvent,
	_context: Context,
): Promise<{ statusCode: number; body: string }> {
	log.info("Indexer Lambda invoked", event);

	const config = loadConfig();

	if (event.forceRecreateIndex !== undefined) {
		config.forceRecreateIndex = event.forceRecreateIndex;
	}

	const chunks = chunksData as DslChunk[];

	try {
		await runIndexing(config, chunks);
		return {
			statusCode: 200,
			body: JSON.stringify({
				message: `Indexed ${chunks.length} chunks successfully`,
			}),
		};
	} catch (err) {
		log.error("Indexing failed:", err);
		return {
			statusCode: 500,
			body: JSON.stringify({
				error: err instanceof Error ? err.message : String(err),
			}),
		};
	}
}
