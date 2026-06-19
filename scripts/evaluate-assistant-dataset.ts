#!/usr/bin/env bun
/**
 * Evaluate the assistant against reference (single-turn) test cases.
 *
 * Sends each NL query via POST /translate or /v2/translate.
 * `multi_turn` cases are skipped by default; pass `--include-multi-turn` to evaluate them.
 *
 * Metrics per test case:
 *   - signature_match: generated command starts with expected_signature
 *   - parameter_match: all parameter tokens from expected_command present in predicted
 *   - exact_match: predicted equals expected (whitespace ignored)
 *   - intent_correct:  (V2 only) top retrieved intent matches ground truth
 *   - refused:         system returned no command / explicitly declined
 *   - success:         signature_match AND parameter_match
 *
 * Comparison normalizes commands by trimming and removing all whitespace before matching.
 *
 * Usage:
 *   bun run evaluate:v1
 *   bun run evaluate:v2:reference
 *   bun run scripts/evaluate-assistant-dataset.ts --in data/validation-dataset-reference.json
 *   bun run scripts/evaluate-assistant-dataset.ts --include-multi-turn --in data/validation-dataset-multi-turn.json
 *   bun run scripts/evaluate-assistant-dataset.ts --limit 50
 *   bun run scripts/evaluate-assistant-dataset.ts --endpoint /v2/translate
 *   bun run scripts/evaluate-assistant-dataset.ts --no-cache
 *   bun run scripts/evaluate-assistant-dataset.ts --offset 100 --limit 200
 */

import fs from "node:fs";
import path from "node:path";

// ── Dataset types (new schema) ──

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

// Legacy flat format (backward compat)
type LegacyRow = {
	query: string;
	intent: string;
	command: string;
	dsl_signature?: string;
	category?: string;
};

// ── Eval result types ──

type TurnResult = {
	query: string;
	expectedCommand: string;
	expectedSignature: string;
	predictedCommand: string | null;
	signatureMatch: boolean;
	parameterMatch: boolean;
	exactMatch: boolean;
	success: boolean;
	refusal: boolean;
	intentCorrect: boolean | null;
	error: string | null;
	truncated: boolean;
};

type EvalRow = {
	id: string;
	type: "reference" | "multi_turn";
	intent: string;
	category: string;
	signatureMatch: boolean;
	parameterMatch: boolean;
	exactMatch: boolean;
	success: boolean;
	refusal: boolean;
	intentCorrect: boolean | null;
	error: string | null;
	truncated: boolean;
	fromCache: boolean;
	// reference: single turn detail
	query?: string;
	expectedCommand?: string;
	predictedCommand?: string | null;
	// multi_turn: per-turn details
	turns?: TurnResult[];
};

type EvalReportFile = {
	generatedAt?: string;
	assistantApiUrl?: string;
	sourceDataset?: string;
	datasetRowCount?: number;
	evaluatedRowCount?: number;
	options?: Record<string, unknown>;
	summary?: Record<string, unknown>;
	results: unknown[];
};

// ── Constants ──

const REFUSAL_PREFIX = "I cannot build a Sabre command from your request.";

// ── Helpers ──

function pickBaseUrl(): string {
	for (const key of ["ASSISTANT_API_URL", "ASSISTANT_URL"] as const) {
		const v = process.env[key]?.trim();
		if (v) return v.replace(/\/$/, "");
	}
	return "http://localhost:3000";
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

function normalizeCommand(s: string): string {
	return s.trim().replace(/\s+/g, " ");
}

/** Strip all whitespace before metric comparison (exact / signature / parameter). */
function normalizeCommandForCompare(s: string): string {
	return s.trim().replace(/\s+/g, "").toUpperCase();
}

function isRefusal(text: string): boolean {
	return text.trimStart().startsWith(REFUSAL_PREFIX);
}

function signatureMatches(
	predicted: string,
	signature: string | null | undefined,
): boolean {
	if (!signature?.trim()) return false;
	const p = normalizeCommandForCompare(predicted);
	const sig = normalizeCommandForCompare(signature);
	return p.startsWith(sig);
}

/**
 * Extract parameter tokens from expected_command by stripping the signature prefix.
 * Then check each token is a substring of the predicted command.
 *
 * For positional Sabre commands, if the right tokens appear with the right signature,
 * the command is correct.
 */
function parameterMatches(
	predicted: string,
	expectedCommand: string,
	expectedSignature: string | null | undefined,
): boolean {
	if (!expectedSignature?.trim()) return false;
	const sig = normalizeCommandForCompare(expectedSignature);
	const predUpper = normalizeCommandForCompare(predicted);
	const expectedUpper = normalizeCommandForCompare(expectedCommand);

	const paramsPart = expectedUpper.startsWith(sig)
		? expectedUpper.slice(sig.length)
		: expectedUpper;

	if (paramsPart.length === 0) return true;

	const tokens = extractParamTokens(paramsPart);
	if (tokens.length === 0) return true;

	return tokens.every((token) => predUpper.includes(token));
}

/**
 * Split parameter string into meaningful tokens.
 * Handles city codes (3-letter), airline codes (2-letter), dates (DDMMM),
 * times (NNA/NNP), numbers, and special characters.
 */
function extractParamTokens(params: string): string[] {
	const tokens: string[] = [];
	const re = /(\d{1,2}[A-Z]{3})|([A-Z]{2,3})|(\d{1,4}[AP])|(\d+)|([≠*‡\-/])/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(params)) !== null) {
		const token = m[0];
		if (token.length >= 1) tokens.push(token);
	}
	return tokens;
}

function isRetryableHttp(status: number, message: string): boolean {
	if (status === 429 || status === 502 || status === 503 || status === 504)
		return true;
	const u = message.toUpperCase();
	return (
		u.includes("THROTTL") ||
		u.includes("TIMEOUT") ||
		u.includes("ECONNRESET") ||
		u.includes("FETCH FAILED") ||
		u.includes("EMBEDDING FAILED")
	);
}

// ── API call ──

type TranslatePayload = {
	command?: string;
	error?: string;
	truncated?: boolean;
	debug?: {
		predictedIntents?: Array<{ intent: string; confidence: number }>;
		[key: string]: unknown;
	};
};

type TranslateResult = {
	predicted: string | null;
	truncated: boolean;
	error: string | null;
	topIntent: string | null;
};

async function translateQuery(
	baseUrl: string,
	query: string,
	retries: number,
	endpoint: string,
	history?: Array<{ query: string; command: string }>,
): Promise<TranslateResult> {
	const url = `${baseUrl}${endpoint}`;
	let lastError = "no attempt";

	for (let attempt = 0; attempt < retries; attempt++) {
		if (attempt > 0) await sleep(1500);
		try {
			const body: Record<string, unknown> = { query };
			if (history && history.length > 0) body.history = history;

			const headers: Record<string, string> = {
				"Content-Type": "application/json",
			};
			if (endpoint.includes("v2")) {
				headers["X-Assistant-Debug"] = "1";
			}

			const res = await fetch(url, {
				method: "POST",
				headers,
				body: JSON.stringify(body),
			});
			const payload = (await res.json()) as TranslatePayload;
			if (!res.ok) {
				lastError = payload.error ?? res.statusText;
				if (
					isRetryableHttp(res.status, lastError) &&
					attempt < retries - 1
				)
					continue;
				return {
					predicted: null,
					truncated: false,
					error: lastError,
					topIntent: null,
				};
			}
			const cmd = payload.command ?? "";

			let topIntent: string | null = null;
			if (
				payload.debug?.predictedIntents &&
				Array.isArray(payload.debug.predictedIntents) &&
				payload.debug.predictedIntents.length > 0
			) {
				topIntent = payload.debug.predictedIntents[0]?.intent ?? null;
			}

			return {
				predicted: cmd,
				truncated: payload.truncated === true,
				error: null,
				topIntent,
			};
		} catch (err) {
			lastError = err instanceof Error ? err.message : String(err);
			if (isRetryableHttp(0, lastError) && attempt < retries - 1) continue;
			return {
				predicted: null,
				truncated: false,
				error: lastError,
				topIntent: null,
			};
		}
	}

	return { predicted: null, truncated: false, error: lastError, topIntent: null };
}

// ── Dataset loading ──

function isNewFormat(data: unknown[]): boolean {
	if (data.length === 0) return false;
	const first = data[0] as Record<string, unknown>;
	return typeof first.id === "string" && typeof first.type === "string";
}

function inferCategory(intent: string): string {
	if (intent.startsWith("encode_") || intent.startsWith("find_closest_") || intent.startsWith("distance_") || intent.startsWith("display_similar") || intent.startsWith("select_similar") || intent.startsWith("redisplay_similar"))
		return "encoding";
	if (intent.startsWith("decode_")) return "decoding";
	if (intent.startsWith("interpret_")) return "interpretation";
	return "availability";
}

function convertLegacyRow(row: LegacyRow, index: number): TestCase {
	return {
		id: `legacy_${String(index + 1).padStart(4, "0")}`,
		type: "reference",
		intent: row.intent ?? "",
		category: row.category ?? inferCategory(row.intent ?? ""),
		query: row.query,
		expected_command: row.command,
		expected_signature: row.dsl_signature ?? "",
	} as ReferenceTestCase;
}

// ── Cache ──

function isRecord(x: unknown): x is Record<string, unknown> {
	return typeof x === "object" && x !== null && !Array.isArray(x);
}

function cacheEntryToEvalRow(raw: unknown): EvalRow | null {
	if (!isRecord(raw)) return null;
	if (typeof raw.id !== "string") return null;
	return raw as unknown as EvalRow;
}

function loadResultsCache(filePath: string): Map<string, EvalRow> {
	const map = new Map<string, EvalRow>();
	if (!fs.existsSync(filePath)) return map;
	let parsed: EvalReportFile;
	try {
		parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as EvalReportFile;
	} catch {
		return map;
	}
	if (!parsed?.results || !Array.isArray(parsed.results)) return map;
	for (const row of parsed.results) {
		const e = cacheEntryToEvalRow(row);
		if (e) map.set(e.id, e);
	}
	return map;
}

// ── Evaluate single test case ──

async function evaluateReference(
	tc: ReferenceTestCase,
	apiUrl: string,
	retries: number,
	endpoint: string,
): Promise<EvalRow> {
	const { predicted, truncated, error, topIntent } = await translateQuery(
		apiUrl,
		tc.query,
		retries,
		endpoint,
	);

	const predNorm = predicted !== null ? normalizeCommand(predicted) : null;
	const refused = predNorm !== null && isRefusal(predNorm);
	const predCompare =
		predicted !== null ? normalizeCommandForCompare(predicted) : null;
	const expCompare = normalizeCommandForCompare(tc.expected_command);
	const sigMatch =
		!refused && predCompare !== null && error === null && signatureMatches(predicted!, tc.expected_signature);
	const paramMatch =
		!refused &&
		predCompare !== null &&
		error === null &&
		parameterMatches(predicted!, tc.expected_command, tc.expected_signature);
	const exact =
		!refused && predCompare !== null && error === null && predCompare === expCompare;
	const intentOk = topIntent !== null ? topIntent === tc.intent : null;

	return {
		id: tc.id,
		type: "reference",
		intent: tc.intent,
		category: tc.category,
		query: tc.query,
		expectedCommand: tc.expected_command,
		predictedCommand: predicted,
		signatureMatch: sigMatch,
		parameterMatch: paramMatch,
		exactMatch: exact,
		success: sigMatch && paramMatch,
		refusal: refused,
		intentCorrect: intentOk,
		error,
		truncated,
		fromCache: false,
	};
}

async function evaluateMultiTurn(
	tc: MultiTurnTestCase,
	apiUrl: string,
	retries: number,
	endpoint: string,
	delayMs: number,
): Promise<EvalRow> {
	const turnResults: TurnResult[] = [];
	const history: Array<{ query: string; command: string }> = [];

	for (let t = 0; t < tc.turns.length; t++) {
		const turn = tc.turns[t]!;
		if (t > 0 && delayMs > 0) await sleep(delayMs);

		const { predicted, truncated, error, topIntent } = await translateQuery(
			apiUrl,
			turn.query,
			retries,
			endpoint,
			t > 0 ? history : undefined,
		);

		const predNorm = predicted !== null ? normalizeCommand(predicted) : null;
		const refused = predNorm !== null && isRefusal(predNorm);
		const predCompare =
			predicted !== null ? normalizeCommandForCompare(predicted) : null;
		const expCompare = normalizeCommandForCompare(turn.expected_command);
		const sigMatch =
			!refused && predCompare !== null && error === null && signatureMatches(predicted!, turn.expected_signature);
		const paramMatch =
			!refused &&
			predCompare !== null &&
			error === null &&
			parameterMatches(predicted!, turn.expected_command, turn.expected_signature);
		const exact =
			!refused && predCompare !== null && error === null && predCompare === expCompare;
		const intentOk = topIntent !== null ? topIntent === tc.intent : null;

		turnResults.push({
			query: turn.query,
			expectedCommand: turn.expected_command,
			expectedSignature: turn.expected_signature,
			predictedCommand: predicted,
			signatureMatch: sigMatch,
			parameterMatch: paramMatch,
			exactMatch: exact,
			success: sigMatch && paramMatch,
			refusal: refused,
			intentCorrect: intentOk,
			error,
			truncated,
		});

		if (sigMatch && paramMatch && predicted && !refused && error === null) {
			history.push({ query: turn.query, command: predicted });
		}
	}

	const lastTurn = turnResults[turnResults.length - 1]!;
	return {
		id: tc.id,
		type: "multi_turn",
		intent: tc.intent,
		category: tc.category,
		turns: turnResults,
		signatureMatch: lastTurn.signatureMatch,
		parameterMatch: lastTurn.parameterMatch,
		exactMatch: lastTurn.exactMatch,
		success: lastTurn.success,
		refusal: lastTurn.refusal,
		intentCorrect: lastTurn.intentCorrect,
		error: lastTurn.error,
		truncated: lastTurn.truncated,
		fromCache: false,
	};
}

// ── Summary ──

function pct(n: number, total: number): number {
	return total ? Math.round((1000 * n) / total) / 10 : 0;
}

type CategoryStats = {
	total: number;
	signatureMatch: number;
	parameterMatch: number;
	exactMatch: number;
	success: number;
	refusals: number;
	intentCorrect: number;
	intentTotal: number;
};

function emptyCategoryStats(): CategoryStats {
	return {
		total: 0,
		signatureMatch: 0,
		parameterMatch: 0,
		exactMatch: 0,
		success: 0,
		refusals: 0,
		intentCorrect: 0,
		intentTotal: 0,
	};
}

function buildSummary(results: EvalRow[], elapsedMs: number) {
	const evaluated = results.length;
	const signatureMatch = results.filter((r) => r.signatureMatch).length;
	const parameterMatch = results.filter((r) => r.parameterMatch).length;
	const exactMatch = results.filter((r) => r.exactMatch).length;
	const success = results.filter((r) => r.success).length;
	const apiErrors = results.filter((r) => r.error !== null).length;
	const refusals = results.filter((r) => r.refusal).length;
	const truncated = results.filter((r) => r.truncated).length;

	const withIntent = results.filter((r) => r.intentCorrect !== null);
	const intentCorrect = withIntent.filter((r) => r.intentCorrect).length;

	const byCategory: Record<string, CategoryStats> = {};
	const byIntent: Record<string, CategoryStats> = {};

	for (const r of results) {
		const cat = r.category || "unknown";
		const int = r.intent || "(unknown)";

		for (const [key, bucket] of [
			[cat, byCategory],
			[int, byIntent],
		] as const) {
			if (!bucket[key]) bucket[key] = emptyCategoryStats();
			const s = bucket[key]!;
			s.total++;
			if (r.signatureMatch) s.signatureMatch++;
			if (r.parameterMatch) s.parameterMatch++;
			if (r.exactMatch) s.exactMatch++;
			if (r.success) s.success++;
			if (r.refusal) s.refusals++;
			if (r.intentCorrect !== null) {
				s.intentTotal++;
				if (r.intentCorrect) s.intentCorrect++;
			}
		}
	}

	return {
		evaluated,
		signatureMatch,
		signatureMatchRate: pct(signatureMatch, evaluated),
		parameterMatch,
		parameterMatchRate: pct(parameterMatch, evaluated),
		exactMatch,
		exactMatchRate: pct(exactMatch, evaluated),
		success,
		successRate: pct(success, evaluated),
		intentCorrect,
		intentTotal: withIntent.length,
		intentAccuracy: pct(intentCorrect, withIntent.length),
		apiErrors,
		refusals,
		refusalRate: pct(refusals, evaluated),
		truncated,
		elapsedMs,
		byCategory,
		byIntent,
	};
}

function printFooter(
	results: EvalRow[],
	elapsedMs: number,
	output: string,
	apiUrl: string,
	fromCache: number,
	fromApi: number,
) {
	const s = buildSummary(results, elapsedMs);
	console.log("\n--- Assistant evaluation ---");
	console.log(`API:                 ${apiUrl}`);
	console.log(`rows evaluated:      ${s.evaluated}`);
	if (fromCache + fromApi > 0)
		console.log(`cache / API calls:   ${fromCache} / ${fromApi}`);
	console.log(
		`signature match:     ${s.signatureMatch} / ${s.evaluated} (${s.signatureMatchRate}%)`,
	);
	console.log(
		`parameter match:     ${s.parameterMatch} / ${s.evaluated} (${s.parameterMatchRate}%)`,
	);
	console.log(
		`success (sig+param): ${s.success} / ${s.evaluated} (${s.successRate}%)`,
	);
	console.log(
		`exact command match: ${s.exactMatch} / ${s.evaluated} (${s.exactMatchRate}%)`,
	);
	if (s.intentTotal > 0)
		console.log(
			`intent accuracy:     ${s.intentCorrect} / ${s.intentTotal} (${s.intentAccuracy}%)`,
		);
	console.log(`refusal rate:        ${s.refusals} / ${s.evaluated} (${s.refusalRate}%)`);
	console.log(`API errors:          ${s.apiErrors}`);
	console.log(`truncated queries:   ${s.truncated}`);
	console.log(`elapsed:             ${(elapsedMs / 1000).toFixed(1)}s`);
	console.log(`written:             ${output}`);

	// Per-category breakdown
	const cats = Object.entries(s.byCategory).sort((a, b) =>
		a[0].localeCompare(b[0]),
	);
	if (cats.length > 0) {
		console.log("\nby category:");
		console.log(
			`  ${"category".padEnd(16)} ${"total".padStart(6)} ${"sig%".padStart(7)} ${"param%".padStart(7)} ${"success%".padStart(9)} ${"refusal%".padStart(9)}`,
		);
		console.log(`  ${"-".repeat(56)}`);
		for (const [cat, v] of cats) {
			console.log(
				`  ${cat.padEnd(16)} ${String(v.total).padStart(6)} ${pct(v.signatureMatch, v.total).toFixed(1).padStart(7)} ${pct(v.parameterMatch, v.total).toFixed(1).padStart(7)} ${pct(v.success, v.total).toFixed(1).padStart(9)} ${pct(v.refusals, v.total).toFixed(1).padStart(9)}`,
			);
		}
	}

	// Sample failures
	const misses = results.filter((r) => !r.success && r.error === null);
	if (misses.length > 0) {
		console.log("\nfirst non-success samples:");
		for (const r of misses.slice(0, 10)) {
			if (r.type === "reference") {
				const pred = (r.predictedCommand ?? "").slice(0, 72);
				const exp = (r.expectedCommand ?? "").slice(0, 72);
				const tag = r.refusal
					? "refusal"
					: r.signatureMatch
						? "sig-ok"
						: "miss";
				console.log(`  [${tag}] ${(r.query ?? "").slice(0, 56)}`);
				console.log(`    expected:  ${exp}`);
				console.log(`    predicted: ${pred}`);
			} else if (r.turns) {
				const last = r.turns[r.turns.length - 1]!;
				const tag = last.refusal
					? "refusal"
					: last.signatureMatch
						? "sig-ok"
						: "miss";
				console.log(
					`  [${tag}] MT: ${last.query.slice(0, 52)} (${r.intent})`,
				);
				console.log(
					`    expected:  ${last.expectedCommand.slice(0, 72)}`,
				);
				console.log(
					`    predicted: ${(last.predictedCommand ?? "").slice(0, 72)}`,
				);
			}
		}
	}

	// Per-intent table
	const intents = Object.entries(s.byIntent).sort((a, b) =>
		a[0].localeCompare(b[0]),
	);
	if (intents.length > 0 && intents.length <= 60) {
		console.log("\nby intent (success rate %):");
		for (const [intent, v] of intents) {
			console.log(
				`  ${intent.padEnd(40)} ${v.success}/${v.total} (${pct(v.success, v.total).toFixed(1)}%)`,
			);
		}
	}
}

// ── CLI args ──

function parseArgs(argv: string[]) {
	const cwd = process.cwd();
	const defaultDataset = path.join(
		cwd,
		"data",
		"validation-dataset-reference.json",
	);
	const defaultResults = path.join(cwd, "data", "assistant-eval-results.json");
	let input = defaultDataset;
	let output = defaultResults;
	let delayMs = 0;
	let retries = 3;
	let limit: number | undefined;
	let offset = 0;
	let useCache = true;
	let endpoint = "/translate";
	let includeMultiTurn = false;

	for (let i = 2; i < argv.length; i++) {
		const a = argv[i];
		const take = () => {
			const v = argv[++i];
			if (!v) throw new Error(`Missing value after ${a}`);
			return v;
		};
		if (a === "--include-multi-turn") {
			includeMultiTurn = true;
		} else if (a === "--no-cache") {
			useCache = false;
		} else if (a === "--in" && argv[i + 1]) {
			input = path.resolve(take());
		} else if (a === "--out" && argv[i + 1]) {
			output = path.resolve(take());
		} else if (a === "--delay" && argv[i + 1]) {
			delayMs = Math.max(0, Number.parseInt(take(), 10) || 0);
		} else if (a === "--retries" && argv[i + 1]) {
			retries = Math.max(1, Number.parseInt(take(), 10) || 1);
		} else if (a === "--limit" && argv[i + 1]) {
			limit = Math.max(1, Number.parseInt(take(), 10) || 1);
		} else if (a === "--offset" && argv[i + 1]) {
			offset = Math.max(0, Number.parseInt(take(), 10) || 0);
		} else if (a === "--endpoint" && argv[i + 1]) {
			endpoint = take();
		}
	}

	if (endpoint !== "/translate" && output === defaultResults) {
		const suffix = endpoint.replace(/\//g, "-").replace(/^-/, "");
		output = path.join(cwd, "data", `assistant-eval-results-${suffix}.json`);
	}

	return {
		input,
		output,
		delayMs,
		retries,
		limit,
		offset,
		useCache,
		endpoint,
		includeMultiTurn,
	};
}

// ── Main ──

async function main() {
	const {
		input,
		output,
		delayMs,
		retries,
		limit,
		offset,
		useCache,
		endpoint,
		includeMultiTurn,
	} = parseArgs(process.argv);
	const apiUrl = pickBaseUrl();
	console.log(`Endpoint: ${endpoint}`);

	const raw = fs.readFileSync(input, "utf8");
	const allData = JSON.parse(raw) as unknown[];
	if (!Array.isArray(allData)) throw new Error("Dataset must be a JSON array");

	// Convert to TestCase array (supports both new and legacy format)
	const allTestCases: TestCase[] = isNewFormat(allData)
		? (allData as TestCase[])
		: (allData as LegacyRow[]).map((r, i) => convertLegacyRow(r, i));

	const multiTurnExcluded = includeMultiTurn
		? 0
		: allTestCases.filter((tc) => tc.type === "multi_turn").length;
	const eligibleTestCases = includeMultiTurn
		? allTestCases
		: allTestCases.filter((tc) => tc.type !== "multi_turn");

	if (multiTurnExcluded > 0) {
		console.log(`Skipping ${multiTurnExcluded} multi_turn case(s) (reference-only eval)`);
	}

	let slice = eligibleTestCases.slice(offset);
	if (limit !== undefined) slice = slice.slice(0, limit);

	const cache = useCache
		? loadResultsCache(output)
		: new Map<string, EvalRow>();
	if (useCache && cache.size > 0)
		console.error(`cache: loaded ${cache.size} row(s) from ${output}`);

	const started = Date.now();
	const results: EvalRow[] = [];
	let fromCache = 0;
	let fromApi = 0;
	let lastWasApi = false;

	for (let i = 0; i < slice.length; i++) {
		const tc = slice[i]!;

		const hit = cache.get(tc.id);
		if (hit) {
			results.push({ ...hit, fromCache: true });
			fromCache++;
			lastWasApi = false;
		} else {
			if (lastWasApi && delayMs > 0) await sleep(delayMs);

			let evalRow: EvalRow;
			if (tc.type === "multi_turn") {
				evalRow = await evaluateMultiTurn(
					tc,
					apiUrl,
					retries,
					endpoint,
					delayMs,
				);
			} else {
				evalRow = await evaluateReference(tc, apiUrl, retries, endpoint);
			}

			results.push(evalRow);
			fromApi++;
			lastWasApi = true;
		}

		if ((i + 1) % 25 === 0 || i === slice.length - 1) {
			const label =
				tc.type === "reference"
					? (tc as ReferenceTestCase).query.slice(0, 40)
					: `MT:${(tc as MultiTurnTestCase).turns[0]?.query.slice(0, 36) ?? ""}`;
			console.log(
				`progress ${i + 1}/${slice.length} [${hit ? "cache" : "API"}] (${label}...)`,
			);
		}
	}

	const elapsedMs = Date.now() - started;

	// Merge with prior cached results
	const mergedById = new Map<string, EvalRow>();
	if (useCache && fs.existsSync(output)) {
		try {
			const prev = JSON.parse(
				fs.readFileSync(output, "utf8"),
			) as EvalReportFile;
			if (Array.isArray(prev.results)) {
				for (const row of prev.results) {
					const e = cacheEntryToEvalRow(row);
					if (!e) continue;
					if (!includeMultiTurn && e.type === "multi_turn") continue;
					mergedById.set(e.id, { ...e, fromCache: true });
				}
			}
		} catch {
			/* ignore corrupt prior file */
		}
	}
	for (const r of results) mergedById.set(r.id, r);
	const mergedResults = [...mergedById.values()];

	const report = {
		generatedAt: new Date().toISOString(),
		assistantApiUrl: apiUrl,
		sourceDataset: path.relative(process.cwd(), input) || input,
		datasetRowCount: allTestCases.length,
		evaluatedRowCount: mergedResults.length,
		options: {
			offset,
			limit: limit ?? null,
			delayMsBetweenCalls: delayMs,
			retriesPerQuery: retries,
			cacheEnabled: useCache,
			endpoint,
			referenceOnly: !includeMultiTurn,
			multiTurnExcluded,
			resultsFromCache: fromCache,
			resultsFromApi: fromApi,
			rowsInThisRun: results.length,
		},
		summary: buildSummary(mergedResults, elapsedMs),
		results: mergedResults,
	};

	fs.mkdirSync(path.dirname(output), { recursive: true });
	fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");

	printFooter(mergedResults, elapsedMs, output, apiUrl, fromCache, fromApi);
}

await main();
