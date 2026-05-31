#!/usr/bin/env bun
/**
 * Generate validation dataset by creating diverse NL queries for pre-defined expected commands.
 *
 * Input:  data/expected-commands.json  (manually created via LLM prompt from prompts/generate-expected-commands.md)
 * Output: data/validation-dataset.json (validation dataset with NL queries + expected commands)
 *
 * For each expected command entry, calls Bedrock Claude to generate 5-10 diverse
 * natural-language operator queries. Uses chunks.json synonyms / user_queries as few-shot seeds.
 *
 * Usage:
 *   bun run generate:validation-dataset
 *   bun run scripts/generate-validation-dataset.ts --commands data/expected-commands.json --count 8
 *   bun run scripts/generate-validation-dataset.ts --dry-run
 */

import fs from "node:fs";
import path from "node:path";
import { LlmService } from "../packages/core/src/index.ts";

// ── Types ──

type ReferenceEntry = {
	intent: string;
	type: "reference";
	category: string;
	expected_command: string;
	expected_signature: string;
};

type MultiTurnEntry = {
	intent: string;
	type: "multi_turn";
	category: string;
	turns: Array<{
		expected_command: string;
		expected_signature: string;
	}>;
};

type ExpectedCommandEntry = ReferenceEntry | MultiTurnEntry;

type Chunk = {
	intent: string;
	type: string;
	description: string;
	format: string | null;
	example: string | null;
	synonyms: string[];
	user_queries: string[];
	dsl_signature: string;
	category: string;
};

type ReferenceTestCase = {
	id: string;
	type: "reference";
	intent: string;
	category: string;
	query: string;
	expected_command: string;
	expected_signature: string;
};

type MultiTurnTestCase = {
	id: string;
	type: "multi_turn";
	intent: string;
	category: string;
	turns: Array<{
		query: string;
		expected_command: string;
		expected_signature: string;
	}>;
};

type TestCase = ReferenceTestCase | MultiTurnTestCase;

// ── LLM Client ──

function createLlmClient() {
	const region = process.env.LLM_REGION ?? process.env.AWS_REGION ?? "us-east-1";
	const modelId = process.env.LLM_MODEL ?? "eu.anthropic.claude-haiku-4-5-20251001-v1:0";
	const llm = new LlmService(region, modelId);

	return async function complete(
		system: string,
		userMessage: string,
		_temperature = 0.8,
	): Promise<string> {
		return llm.completeWithSystem(system, userMessage, {
			maxTokens: 1024,
			temperature: _temperature,
		});
	};
}

// ── Prompt builders ──

const SYSTEM_PROMPT = `You are a Sabre GDS training data generator. Your job is to create diverse natural-language queries that a travel agency operator might type when they want to execute a specific Sabre command.

Rules:
- Generate ONLY the JSON array of query strings, nothing else
- Each query must be a realistic operator question/request in English
- Vary the style: formal ("Could you encode the city Paris?"), informal ("city code paris"), abbreviated ("cc paris"), partial Sabre mixed with NL ("w/-cc for paris"), telegraphic ("paris city code pls")
- Include occasional typos or shorthand that real operators use
- CRITICAL: Every query MUST use the EXACT SAME parameters (city names, airport codes, dates, flight numbers, airline codes, etc.) as the expected command. Do NOT invent different cities, dates, or other parameter values. If the command is W/-CCPARIS, ALL queries must ask about Paris specifically. If the command is 110MARJFKLHR, ALL queries must reference JFK, LHR, and March 10.
- NEVER include the Sabre command itself as a query — the operator is asking for help, not typing the command
- NEVER wrap queries in markdown or code blocks
- For modifier commands (multi-turn), the query should be contextual — assume the operator already has a previous search active (e.g., "add 3 days" not "add 3 days to the search for flights from DEL to JFK")
- Output valid JSON: an array of strings`;

function buildReferencePrompt(
	entry: ReferenceEntry,
	chunk: Chunk | undefined,
	count: number,
): string {
	const seeds = chunk
		? [
				...chunk.user_queries.slice(0, 4),
				...chunk.synonyms.slice(0, 3),
			]
		: [];

	const seedBlock =
		seeds.length > 0
			? `\nExample queries for this intent (use as style inspiration, do NOT copy verbatim):\n${seeds.map((s) => `- "${s}"`).join("\n")}`
			: "";

	const desc = chunk?.description ?? entry.intent.replace(/_/g, " ");
	const format = chunk?.format ?? "";

	const params = entry.expected_command
		.replace(entry.expected_signature, "")
		.trim();

	return `Generate ${count} diverse natural-language queries for this Sabre command:

Intent: ${entry.intent}
Description: ${desc}
Command format: ${format}
Expected command: ${entry.expected_command}
DSL signature: ${entry.expected_signature}
Parameters in the command: ${params || "(none)"}
Category: ${entry.category}
${seedBlock}

IMPORTANT: Every query MUST refer to the exact same parameters as "${entry.expected_command}". For example, if the command encodes Paris, every query must ask about Paris — not London or Tokyo. Vary only the phrasing and style, NOT the parameters.

Return a JSON array of ${count} query strings. Example format:
["query one", "query two", "query three"]`;
}

function buildMultiTurnPrompt(
	entry: MultiTurnEntry,
	chunk: Chunk | undefined,
	firstTurnChunk: Chunk | undefined,
	count: number,
): string {
	const lastTurn = entry.turns[entry.turns.length - 1]!;
	const firstTurn = entry.turns[0]!;

	const seeds = chunk
		? [...chunk.user_queries.slice(0, 4), ...chunk.synonyms.slice(0, 3)]
		: [];

	const firstSeeds = firstTurnChunk
		? firstTurnChunk.user_queries.slice(0, 3)
		: [];

	const seedBlock =
		seeds.length > 0
			? `\nExample queries for the modifier command (style inspiration only):\n${seeds.map((s) => `- "${s}"`).join("\n")}`
			: "";

	const firstSeedBlock =
		firstSeeds.length > 0
			? `\nExample queries for the initial search (style inspiration only):\n${firstSeeds.map((s) => `- "${s}"`).join("\n")}`
			: "";

	const desc = chunk?.description ?? entry.intent.replace(/_/g, " ");

	return `Generate ${count} multi-turn conversation pairs for this Sabre workflow.

This is a multi-turn scenario:
- Turn 1: Initial flight availability search
  Command: ${firstTurn.expected_command}
  Signature: ${firstTurn.expected_signature}
${firstSeedBlock}

- Turn 2: Modifier command (the intent being tested)
  Intent: ${entry.intent}
  Description: ${desc}
  Command: ${lastTurn.expected_command}
  Signature: ${lastTurn.expected_signature}
${seedBlock}

For each pair, generate:
1. A natural query for the initial search — MUST use the exact same route and date as in "${firstTurn.expected_command}" (do NOT change cities, dates, or other parameters)
2. A contextual follow-up query for the modifier — MUST match the exact parameters from "${lastTurn.expected_command}" (e.g., if the command adds 3 days, every query must say 3 days, not 5)

IMPORTANT: Vary only the phrasing and style. Do NOT change any parameter values (cities, dates, numbers).

Return a JSON array of ${count} objects, each with "turn1" and "turn2" string fields:
[{"turn1": "find flights from Delhi to New York on March 10", "turn2": "add 3 more days"}, ...]`;
}

// ── Parse LLM response ──

function parseJsonArray(raw: string): string[] {
	const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
	try {
		const parsed = JSON.parse(cleaned);
		if (Array.isArray(parsed)) return parsed.filter((x) => typeof x === "string");
	} catch {
		const match = cleaned.match(/\[[\s\S]*\]/);
		if (match) {
			try {
				const parsed = JSON.parse(match[0]);
				if (Array.isArray(parsed)) return parsed.filter((x) => typeof x === "string");
			} catch { /* fall through */ }
		}
	}
	return [];
}

function parseMultiTurnArray(raw: string): Array<{ turn1: string; turn2: string }> {
	const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
	try {
		const parsed = JSON.parse(cleaned);
		if (Array.isArray(parsed)) {
			return parsed.filter(
				(x) =>
					typeof x === "object" &&
					x !== null &&
					typeof x.turn1 === "string" &&
					typeof x.turn2 === "string",
			);
		}
	} catch {
		const match = cleaned.match(/\[[\s\S]*\]/);
		if (match) {
			try {
				const parsed = JSON.parse(match[0]);
				if (Array.isArray(parsed)) {
					return parsed.filter(
						(x) =>
							typeof x === "object" &&
							x !== null &&
							typeof x.turn1 === "string" &&
							typeof x.turn2 === "string",
					);
				}
			} catch { /* fall through */ }
		}
	}
	return [];
}

// ── Deduplication ──

function isSabreCommandEcho(query: string, command: string): boolean {
	const norm = (s: string) => s.trim().replace(/\s+/g, "").toUpperCase();
	return norm(query) === norm(command);
}

// ── CLI args ──

function parseArgs(argv: string[]) {
	const cwd = process.cwd();
	let commands = path.join(cwd, "data", "expected-commands.json");
	let chunks = path.join(cwd, "chunks.json");
	let out = path.join(cwd, "data", "validation-dataset.json");
	let count = 8;
	let dryRun = false;
	let delayMs = 300;

	for (let i = 2; i < argv.length; i++) {
		const a = argv[i];
		const take = () => {
			const v = argv[++i];
			if (!v) throw new Error(`Missing value after ${a}`);
			return v;
		};
		if (a === "--commands") commands = path.resolve(take());
		else if (a === "--chunks") chunks = path.resolve(take());
		else if (a === "--out") out = path.resolve(take());
		else if (a === "--count") count = Math.max(1, Number.parseInt(take(), 10) || 8);
		else if (a === "--dry-run") dryRun = true;
		else if (a === "--delay") delayMs = Math.max(0, Number.parseInt(take(), 10) || 0);
	}

	return { commands, chunks, out, count, dryRun, delayMs };
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

// ── Main ──

async function main() {
	const args = parseArgs(process.argv);

	if (!fs.existsSync(args.commands)) {
		console.error(`Expected commands file not found: ${args.commands}`);
		console.error(
			"Create it manually using the prompt from prompts/generate-expected-commands.md",
		);
		console.error(
			"Or copy data/expected-commands.example.json as a starting point.",
		);
		process.exit(1);
	}

	const entries = JSON.parse(
		fs.readFileSync(args.commands, "utf8"),
	) as ExpectedCommandEntry[];

	const chunksData = JSON.parse(
		fs.readFileSync(args.chunks, "utf8"),
	) as Chunk[];

	const chunksByIntent = new Map<string, Chunk>();
	for (const c of chunksData) {
		chunksByIntent.set(c.intent, c);
	}

	console.log(
		`Loaded ${entries.length} expected command entries, ${chunksData.length} chunks`,
	);
	console.log(`Generating ${args.count} queries per entry`);

	if (args.dryRun) {
		console.log("\n--- DRY RUN: showing prompts, no API calls ---\n");
		for (const entry of entries.slice(0, 3)) {
			const chunk = chunksByIntent.get(entry.intent);
			if (entry.type === "multi_turn") {
				const firstIntentChunk = chunksByIntent.get("request_flight_availability");
				console.log(
					buildMultiTurnPrompt(entry, chunk, firstIntentChunk, args.count),
				);
			} else {
				console.log(buildReferencePrompt(entry, chunk, args.count));
			}
			console.log("\n---\n");
		}
		console.log(`(showing first 3 of ${entries.length} entries)`);
		return;
	}

	const llm = createLlmClient();
	const dataset: TestCase[] = [];
	const seenQueries = new Set<string>();
	let refCounter = 0;
	let mtCounter = 0;
	let totalGenerated = 0;
	let totalDeduplicated = 0;

	for (let i = 0; i < entries.length; i++) {
		const entry = entries[i]!;
		const chunk = chunksByIntent.get(entry.intent);

		console.log(
			`[${i + 1}/${entries.length}] ${entry.intent} (${entry.type}) ...`,
		);

		if (entry.type === "multi_turn") {
			const firstIntentChunk = chunksByIntent.get("request_flight_availability");
			const prompt = buildMultiTurnPrompt(
				entry,
				chunk,
				firstIntentChunk,
				args.count,
			);

			let pairs: Array<{ turn1: string; turn2: string }> = [];
			for (let attempt = 0; attempt < 3; attempt++) {
				try {
					const raw = await llm(SYSTEM_PROMPT, prompt);
					pairs = parseMultiTurnArray(raw);
					if (pairs.length > 0) break;
					console.warn(
						`  attempt ${attempt + 1}: got 0 pairs, retrying...`,
					);
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					console.warn(`  attempt ${attempt + 1} failed: ${msg}`);
					if (attempt < 2) await sleep(2000);
				}
			}

			for (const pair of pairs) {
				const normKey = pair.turn2.trim().toLowerCase();
				totalGenerated++;
				if (seenQueries.has(normKey)) {
					totalDeduplicated++;
					continue;
				}

				const lastTurnCmd = entry.turns[entry.turns.length - 1]!;
				if (isSabreCommandEcho(pair.turn2, lastTurnCmd.expected_command)) {
					totalDeduplicated++;
					continue;
				}

				seenQueries.add(normKey);
				mtCounter++;
				dataset.push({
					id: `mt_${String(mtCounter).padStart(3, "0")}`,
					type: "multi_turn",
					intent: entry.intent,
					category: entry.category,
					turns: [
						{
							query: pair.turn1.trim(),
							expected_command: entry.turns[0]!.expected_command,
							expected_signature: entry.turns[0]!.expected_signature,
						},
						{
							query: pair.turn2.trim(),
							expected_command: lastTurnCmd.expected_command,
							expected_signature: lastTurnCmd.expected_signature,
						},
					],
				});
			}

			console.log(`  -> ${pairs.length} pairs generated`);
		} else {
			const prompt = buildReferencePrompt(entry, chunk, args.count);

			let queries: string[] = [];
			for (let attempt = 0; attempt < 3; attempt++) {
				try {
					const raw = await llm(SYSTEM_PROMPT, prompt);
					queries = parseJsonArray(raw);
					if (queries.length > 0) break;
					console.warn(
						`  attempt ${attempt + 1}: got 0 queries, retrying...`,
					);
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					console.warn(`  attempt ${attempt + 1} failed: ${msg}`);
					if (attempt < 2) await sleep(2000);
				}
			}

			for (const q of queries) {
				const normKey = q.trim().toLowerCase();
				totalGenerated++;
				if (seenQueries.has(normKey)) {
					totalDeduplicated++;
					continue;
				}
				if (isSabreCommandEcho(q, entry.expected_command)) {
					totalDeduplicated++;
					continue;
				}

				seenQueries.add(normKey);
				refCounter++;
				dataset.push({
					id: `ref_${String(refCounter).padStart(3, "0")}`,
					type: "reference",
					intent: entry.intent,
					category: entry.category,
					query: q.trim(),
					expected_command: entry.expected_command,
					expected_signature: entry.expected_signature,
				});
			}

			console.log(`  -> ${queries.length} queries generated`);
		}

		if (i < entries.length - 1 && args.delayMs > 0) {
			await sleep(args.delayMs);
		}
	}

	fs.mkdirSync(path.dirname(args.out), { recursive: true });
	fs.writeFileSync(args.out, `${JSON.stringify(dataset, null, 2)}\n`, "utf8");

	const { writeSplitValidationDatasets } = await import(
		"./split-validation-dataset.ts"
	);
	const split = writeSplitValidationDatasets(args.out);
	console.log(`Split reference:  ${split.reference.length} -> ${split.referencePath}`);
	console.log(`Split multi-turn: ${split.multiTurn.length} -> ${split.multiTurnPath}`);

	console.log(`\n--- Generation complete ---`);
	console.log(`Total entries processed: ${entries.length}`);
	console.log(`Total queries generated: ${totalGenerated}`);
	console.log(`Deduplicated/filtered:   ${totalDeduplicated}`);
	console.log(`Reference test cases:    ${refCounter}`);
	console.log(`Multi-turn test cases:   ${mtCounter}`);
	console.log(`Total dataset size:      ${dataset.length}`);
	console.log(`Written to:              ${args.out}`);
}

await main();
