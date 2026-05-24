import {
	type AppConfig,
	EmbeddingService,
	LlmService,
	SearchClient,
	log,
	truncateQueryToMaxTokens,
} from "core";
import { rewriteQuery } from "./rewrite-query.ts";
import { findRelevantChunksV2 } from "./hybrid-search.ts";
import { classifyIntent } from "./classify-intent.ts";
import { filterContext } from "./filter-context.ts";
import { assemblePromptV2 } from "./assemble-prompt-v2.ts";
import { validateAndNormalize } from "./validate-command.ts";
import { addTurnToSession, getSessionHistory } from "./session.ts";
import type {
	IntentCentroid,
	TranslateQueryV2Options,
	TranslateQueryV2Result,
	V2Config,
	V2DebugInfo,
} from "./types.ts";

export function loadV2Config(): V2Config {
	return {
		retrievalTopK: Number.parseInt(process.env.V2_RETRIEVAL_TOP_K ?? "6", 10),
		contextLimit: Number.parseInt(process.env.V2_CONTEXT_LIMIT ?? "3", 10),
		scoreThreshold: Number.parseFloat(
			process.env.V2_SCORE_THRESHOLD ?? "0",
		),
		intentConfidenceThreshold: Number.parseFloat(
			process.env.V2_INTENT_CONFIDENCE_THRESHOLD ?? "0.6",
		),
		enableRetry: (process.env.V2_ENABLE_RETRY ?? "true") === "true",
	};
}

export async function translateQueryV2(
	query: string,
	config: AppConfig,
	intentCentroids: IntentCentroid[],
	options?: TranslateQueryV2Options,
): Promise<TranslateQueryV2Result> {
	const v2Config = loadV2Config();
	const timings: V2DebugInfo["latencyMs"] = {
		rewrite: 0,
		embed: 0,
		search: 0,
		intent: 0,
		filter: 0,
		llm: 0,
		total: 0,
	};
	const totalStart = Date.now();

	// 1. Truncate
	const { text: boundedQuery, truncated } = truncateQueryToMaxTokens(
		query,
		config.maxQueryTokens,
	);

	if (truncated) {
		log.warn("Query truncated to max token budget");
	}

	// Session context: prefer client-side history, fallback to server-side session
	const clientHistory = options?.history?.map((h) => ({
		query: h.query,
		command: h.command,
		intent: null,
		timestamp: 0,
	}));
	const sessionHistory = clientHistory?.length
		? clientHistory
		: options?.sessionId
			? getSessionHistory(options.sessionId)
			: undefined;

	// 2. LLM: rewrite query (with session context if available)
	const llm = new LlmService(config.llmRegion, config.llmModel);
	const rewriteStart = Date.now();
	const rewrittenQuery = await rewriteQuery(
		llm,
		boundedQuery,
		sessionHistory?.length ? sessionHistory : undefined,
	);
	timings.rewrite = Date.now() - rewriteStart;
	log.info(`Rewritten query: "${rewrittenQuery}"`);

	// 3. Embed rewritten query
	const embedder = new EmbeddingService(
		config.awsRegion,
		config.embeddingModel,
		config.embeddingDimensions,
	);
	const embedStart = Date.now();
	const search = new SearchClient(config.opensearchEndpoint, config.awsRegion);

	// 4. Hybrid search
	const searchStart = Date.now();
	const { chunks: retrievedChunks, queryVector } = await findRelevantChunksV2(
		search,
		embedder,
		config.opensearchIndex,
		rewrittenQuery,
		v2Config.retrievalTopK,
	);
	timings.embed = searchStart - embedStart;
	timings.search = Date.now() - searchStart;

	log.info(`Retrieved ${retrievedChunks.length} chunks`);
	log.debug(
		"Retrieved:",
		retrievedChunks.map((c) => ({
			intent: c.source.intent,
			score: c.score,
		})),
	);

	// 5. Classify intent
	const intentStart = Date.now();
	const predictedIntents =
		intentCentroids.length > 0
			? classifyIntent(queryVector, intentCentroids, 3)
			: null;
	timings.intent = Date.now() - intentStart;

	if (predictedIntents?.length) {
		log.info(
			`Predicted intents: ${predictedIntents.map((p) => `${p.intent}(${p.confidence.toFixed(2)})`).join(", ")}`,
		);
	}

	// 6. Filter & deduplicate context
	const filterStart = Date.now();
	const filteredChunks = filterContext(retrievedChunks, predictedIntents, {
		scoreThreshold: v2Config.scoreThreshold,
		contextLimit: v2Config.contextLimit,
		intentConfidenceThreshold: v2Config.intentConfidenceThreshold,
	});
	timings.filter = Date.now() - filterStart;

	log.info(`Filtered to ${filteredChunks.length} chunks`);

	// 7. Assemble V2 prompt (with session history for context)
	const { system, user } = assemblePromptV2(
		filteredChunks,
		boundedQuery,
		predictedIntents,
		sessionHistory?.length ? sessionHistory : undefined,
	);

	// 8. LLM generate
	const llmStart = Date.now();
	const rawOutput = await llm.completeWithSystem(system, user);
	timings.llm = Date.now() - llmStart;

	log.info(`Raw LLM output: "${rawOutput}"`);

	// 9. DSL validate & normalize
	let result = validateAndNormalize(rawOutput, predictedIntents);

	// Optional retry if validation detects issues and confidence is high
	if (
		v2Config.enableRetry &&
		!result.isRefusal &&
		result.validationApplied &&
		predictedIntents?.[0]?.confidence &&
		predictedIntents[0].confidence >= 0.8
	) {
		const topIntent = predictedIntents[0];
		if (
			topIntent.dsl_signature &&
			!result.command.startsWith(topIntent.dsl_signature)
		) {
			log.info(
				`Retry: command "${result.command}" doesn't match expected signature "${topIntent.dsl_signature}"`,
			);
			const retryUser = `${user}\n\nIMPORTANT: The command MUST start with "${topIntent.dsl_signature}". Your previous answer "${result.command}" was incorrect.`;
			const retryOutput = await llm.completeWithSystem(system, retryUser);
			const retryResult = validateAndNormalize(retryOutput, predictedIntents);
			if (
				!retryResult.isRefusal &&
				retryResult.command.startsWith(topIntent.dsl_signature)
			) {
				result = retryResult;
				log.info(`Retry succeeded: "${result.command}"`);
			}
		}
	}

	timings.total = Date.now() - totalStart;

	// 10. Build debug info
	const debug: V2DebugInfo | undefined = options?.debug
		? {
				rewrittenQuery,
				retrievedChunks: retrievedChunks.map((c) => ({
					intent: c.source.intent,
					score: c.score,
					dsl_signature: c.source.dsl_signature,
				})),
				predictedIntents,
				contextAfterFiltering: filteredChunks.map((c) => c.source.intent),
				finalPrompt: { system, user },
				rawLlmOutput: rawOutput,
				validationApplied: result.validationApplied,
				latencyMs: timings,
			}
		: undefined;

	// Save to session (only successful commands, not refusals)
	if (options?.sessionId && !result.isRefusal) {
		addTurnToSession(options.sessionId, {
			query: boundedQuery,
			command: result.command,
			intent: predictedIntents?.[0]?.intent ?? null,
			timestamp: Date.now(),
		});
	}

	return {
		command: result.command,
		truncated,
		...(debug ? { debug } : {}),
	};
}
