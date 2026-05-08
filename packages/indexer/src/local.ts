import { loadConfig, log } from "core";
import type { DslChunk } from "core";
import { runIndexing } from "./run-indexing.ts";

const chunksPath = new URL("../../../chunks.json", import.meta.url);
const chunksData = await Bun.file(chunksPath).json();
const chunks = chunksData as DslChunk[];

log.info(`Loaded ${chunks.length} chunks from chunks.json`);

const config = loadConfig();
log.info("Config:", {
	endpoint: config.opensearchEndpoint,
	index: config.opensearchIndex,
	model: config.embeddingModel,
	forceRecreate: config.forceRecreateIndex,
});

await runIndexing(config, chunks);
log.info("Local indexing complete");
