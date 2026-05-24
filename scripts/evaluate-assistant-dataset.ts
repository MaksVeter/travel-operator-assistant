#!/usr/bin/env bun
/**
 * Evaluate the deployed (or local) assistant against `data/validation-dataset.json`.
 * Sends each NL query via POST /translate (same contract as `bun run cli`).
 *
 * Set ASSISTANT_API_URL in root `.env` to API Gateway base (stage path, no trailing slash).
 * Local smoke: `assistant:local` on :3000 and omit ASSISTANT_API_URL (defaults to localhost:3000).
 *
 * Usage (from travel-operator-assistant):
 *   bun run evaluate:assistant
 *   bun run scripts/evaluate-assistant-dataset.ts --limit 50
 *   bun run scripts/evaluate-assistant-dataset.ts --delay 500 --retries 3
 *   bun run scripts/evaluate-assistant-dataset.ts --no-cache
 *   bun run scripts/evaluate-assistant-dataset.ts --offset 100 --limit 200
 */

import fs from "node:fs";
import path from "node:path";

type DatasetRow = {
	query: string;
	intent: string;
	command: string;
	dsl_signature?: string;
};

type EvalRow = {
	query: string;
	intent: string;
	expectedCommand: string;
	dslSignature: string | null;
	predictedCommand: string | null;
	exactMatch: boolean;
	signatureMatch: boolean;
	refusal: boolean;
	unexpectedRefusal: boolean;
	truncated: boolean;
	error: string | null;
	fromCache: boolean;
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

const REFUSAL_PREFIX = "I cannot build a Sabre command from your request.";

function pickBaseUrl(): string {
	for (const key of ["ASSISTANT_API_URL", "ASSISTANT_URL"] as const) {
		const v = process.env[key]?.trim();
		if (v) return v.replace(/\/$/, "");
	}
	return "http://localhost:3000";
}

function parseArgs(argv: string[]) {
	const cwd = process.cwd();
	const defaultDataset = path.join(cwd, "data", "validation-dataset.json");
	const defaultResults = path.join(cwd, "data", "assistant-eval-results.json");
	let input = defaultDataset;
	let output = defaultResults;
	let delayMs = 0;
	let retries = 3;
	let limit: number | undefined;
	let offset = 0;
	let useCache = true;
	let endpoint = "/translate";

	for (let i = 2; i < argv.length; i++) {
		const a = argv[i];
		const take = () => {
			const v = argv[++i];
			if (!v) throw new Error(`Missing value after ${a}`);
			return v;
		};
		if (a === "--no-cache") {
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

	// Adjust output filename for non-default endpoints
	if (endpoint !== "/translate" && output === defaultResults) {
		const suffix = endpoint.replace(/\//g, "-").replace(/^-/, "");
		output = path.join(cwd, "data", `assistant-eval-results-${suffix}.json`);
	}

	return { input, output, delayMs, retries, limit, offset, useCache, endpoint };
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

function normalizeCommand(s: string): string {
	return s.trim().replace(/\s+/g, " ");
}

function isRefusal(text: string): boolean {
	return text.trimStart().startsWith(REFUSAL_PREFIX);
}

function signatureMatches(predicted: string, signature: string | null | undefined): boolean {
	if (!signature?.trim()) return false;
	const p = normalizeCommand(predicted).toUpperCase();
	const sig = signature.trim().toUpperCase();
	return p.startsWith(sig);
}

function isRetryableHttp(status: number, message: string): boolean {
	if (status === 429 || status === 502 || status === 503 || status === 504) {
		return true;
	}
	const u = message.toUpperCase();
	return (
		u.includes("THROTTL") ||
		u.includes("TIMEOUT") ||
		u.includes("ECONNRESET") ||
		u.includes("FETCH FAILED") ||
		u.includes("EMBEDDING FAILED")
	);
}

type TranslatePayload = {
	command?: string;
	error?: string;
	truncated?: boolean;
};

async function translateQuery(
	baseUrl: string,
	query: string,
	retries: number,
	endpoint = "/translate",
): Promise<{
	predicted: string | null;
	truncated: boolean;
	error: string | null;
}> {
	const url = `${baseUrl}${endpoint}`;
	let lastError = "no attempt";

	for (let attempt = 0; attempt < retries; attempt++) {
		if (attempt > 0) await sleep(1500);
		try {
			const res = await fetch(url, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ query }),
			});
			const payload = (await res.json()) as TranslatePayload;
			if (!res.ok) {
				lastError = payload.error ?? res.statusText;
				if (isRetryableHttp(res.status, lastError) && attempt < retries - 1) {
					continue;
				}
				return { predicted: null, truncated: false, error: lastError };
			}
			const cmd = payload.command ?? "";
			return {
				predicted: cmd,
				truncated: payload.truncated === true,
				error: null,
			};
		} catch (err) {
			lastError = err instanceof Error ? err.message : String(err);
			if (isRetryableHttp(0, lastError) && attempt < retries - 1) {
				continue;
			}
			return { predicted: null, truncated: false, error: lastError };
		}
	}

	return { predicted: null, truncated: false, error: lastError };
}

function isRecord(x: unknown): x is Record<string, unknown> {
	return typeof x === "object" && x !== null && !Array.isArray(x);
}

function cacheEntryToEvalRow(raw: unknown): EvalRow | null {
	if (!isRecord(raw) || typeof raw.query !== "string") return null;
	const query = raw.query;
	const expected =
		typeof raw.expectedCommand === "string"
			? raw.expectedCommand
			: typeof raw.command === "string"
				? raw.command
				: null;
	if (!expected) return null;

	const predicted =
		typeof raw.predictedCommand === "string"
			? raw.predictedCommand
			: raw.predictedCommand === null
				? null
				: undefined;
	if (predicted === undefined) return null;

	const intent = typeof raw.intent === "string" ? raw.intent : "";
	const dslSignature =
		typeof raw.dslSignature === "string"
			? raw.dslSignature
			: typeof raw.dsl_signature === "string"
				? raw.dsl_signature
				: null;

	return {
		query,
		intent,
		expectedCommand: expected,
		dslSignature,
		predictedCommand: predicted,
		exactMatch: raw.exactMatch === true,
		signatureMatch: raw.signatureMatch === true,
		refusal: raw.refusal === true,
		unexpectedRefusal: raw.unexpectedRefusal === true,
		truncated: raw.truncated === true,
		error: raw.error === null || raw.error === undefined ? null : String(raw.error),
		fromCache: true,
	};
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
		if (e) map.set(e.query, e);
	}
	return map;
}

function buildSummary(results: EvalRow[], elapsedMs: number) {
	const evaluated = results.length;
	const exactMatch = results.filter((r) => r.exactMatch).length;
	const signatureMatch = results.filter((r) => r.signatureMatch).length;
	const apiErrors = results.filter((r) => r.error !== null).length;
	const refusals = results.filter((r) => r.refusal).length;
	const unexpectedRefusals = results.filter((r) => r.unexpectedRefusal).length;
	const truncated = results.filter((r) => r.truncated).length;

	const byIntent: Record<
		string,
		{ total: number; exactMatch: number; signatureMatch: number; exactMatchRate: number }
	> = {};
	for (const r of results) {
		const key = r.intent || "(unknown)";
		if (!byIntent[key]) {
			byIntent[key] = { total: 0, exactMatch: 0, signatureMatch: 0, exactMatchRate: 0 };
		}
		byIntent[key].total++;
		if (r.exactMatch) byIntent[key].exactMatch++;
		if (r.signatureMatch) byIntent[key].signatureMatch++;
	}
	for (const v of Object.values(byIntent)) {
		v.exactMatchRate = v.total
			? Math.round((1000 * v.exactMatch) / v.total) / 10
			: 0;
	}

	return {
		evaluated,
		exactMatch,
		exactMatchRate: evaluated
			? Math.round((1000 * exactMatch) / evaluated) / 10
			: 0,
		signatureMatch,
		signatureMatchRate: evaluated
			? Math.round((1000 * signatureMatch) / evaluated) / 10
			: 0,
		apiErrors,
		refusals,
		unexpectedRefusals,
		truncated,
		elapsedMs,
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
	console.log(`API:                ${apiUrl}`);
	console.log(`rows evaluated:     ${s.evaluated}`);
	if (fromCache + fromApi > 0) {
		console.log(`cache / API calls:    ${fromCache} / ${fromApi}`);
	}
	console.log(
		`exact command match: ${s.exactMatch} / ${s.evaluated} (${s.exactMatchRate}%)`,
	);
	console.log(
		`DSL signature match: ${s.signatureMatch} / ${s.evaluated} (${s.signatureMatchRate}%)`,
	);
	console.log(`API errors:         ${s.apiErrors}`);
	console.log(`refusals:           ${s.refusals} (unexpected: ${s.unexpectedRefusals})`);
	console.log(`truncated queries:  ${s.truncated}`);
	console.log(`elapsed:            ${(elapsedMs / 1000).toFixed(1)}s`);
	console.log(`written:            ${output}`);

	const misses = results.filter((r) => !r.exactMatch && r.error === null);
	if (misses.length > 0) {
		console.log("\nfirst non-exact samples:");
		for (const r of misses.slice(0, 10)) {
			const pred = (r.predictedCommand ?? "").slice(0, 72);
			const exp = r.expectedCommand.slice(0, 72);
			const tag = r.refusal ? "refusal" : r.signatureMatch ? "sig-ok" : "miss";
			console.log(`  [${tag}] ${r.query.slice(0, 56)}`);
			console.log(`    expected:  ${exp}`);
			console.log(`    predicted: ${pred}`);
		}
	}

	const intents = Object.entries(s.byIntent).sort((a, b) => a[0].localeCompare(b[0]));
	if (intents.length > 0 && intents.length <= 60) {
		console.log("\nby intent (exact match %):");
		for (const [intent, v] of intents) {
			console.log(`  ${intent.padEnd(28)} ${v.exactMatch}/${v.total} (${v.exactMatchRate}%)`);
		}
	}
}

async function main() {
	const { input, output, delayMs, retries, limit, offset, useCache, endpoint } = parseArgs(
		process.argv,
	);
	const apiUrl = pickBaseUrl();
	console.log(`Endpoint: ${endpoint}`);

	const raw = fs.readFileSync(input, "utf8");
	const allRows = JSON.parse(raw) as DatasetRow[];
	if (!Array.isArray(allRows)) {
		throw new Error("Dataset must be a JSON array");
	}

	let slice = allRows.slice(offset);
	if (limit !== undefined) slice = slice.slice(0, limit);

	const cache = useCache ? loadResultsCache(output) : new Map<string, EvalRow>();
	if (useCache && cache.size > 0) {
		console.error(`cache: loaded ${cache.size} query row(s) from ${output}`);
	}

	const started = Date.now();
	const results: EvalRow[] = [];
	let fromCache = 0;
	let fromApi = 0;
	let lastWasApi = false;

	for (let i = 0; i < slice.length; i++) {
		const row = slice[i]!;
		const query = row.query?.trim();
		if (!query) continue;

		const expected = row.command?.trim() ?? "";
		const dslSignature = row.dsl_signature ?? null;

		const hit = cache.get(query);
		if (hit) {
			results.push({ ...hit, fromCache: true });
			fromCache++;
			lastWasApi = false;
		} else {
			if (lastWasApi && delayMs > 0) await sleep(delayMs);
			const { predicted, truncated, error } = await translateQuery(
				apiUrl,
				query,
				retries,
				endpoint,
			);
			const predictedNorm = predicted !== null ? normalizeCommand(predicted) : null;
			const expectedNorm = normalizeCommand(expected);
			const refusal = predictedNorm !== null && isRefusal(predictedNorm);
			const exactMatch =
				error === null &&
				predictedNorm !== null &&
				!refusal &&
				predictedNorm === expectedNorm;
			const signatureMatch =
				error === null &&
				predictedNorm !== null &&
				!refusal &&
				signatureMatches(predictedNorm, dslSignature);

			results.push({
				query,
				intent: row.intent ?? "",
				expectedCommand: expected,
				dslSignature,
				predictedCommand: predicted,
				exactMatch,
				signatureMatch,
				refusal,
				unexpectedRefusal: refusal && expected.length > 0,
				truncated,
				error,
				fromCache: false,
			});
			fromApi++;
			lastWasApi = true;
		}

		if ((i + 1) % 25 === 0 || i === slice.length - 1) {
			const src = hit ? "cache" : "API";
			console.log(
				`progress ${i + 1}/${slice.length} [${src}] (${query.slice(0, 52)}…)`,
			);
		}
	}

	const elapsedMs = Date.now() - started;

	// Merge with prior rows in --out (resume / chunked runs by --offset --limit).
	const mergedByQuery = new Map<string, EvalRow>();
	if (useCache && fs.existsSync(output)) {
		try {
			const prev = JSON.parse(fs.readFileSync(output, "utf8")) as EvalReportFile;
			if (Array.isArray(prev.results)) {
				for (const row of prev.results) {
					const e = cacheEntryToEvalRow(row);
					if (e) mergedByQuery.set(e.query, { ...e, fromCache: true });
				}
			}
		} catch {
			/* ignore corrupt prior file */
		}
	}
	for (const r of results) {
		mergedByQuery.set(r.query, r);
	}
	const mergedResults = [...mergedByQuery.values()];

	const report = {
		generatedAt: new Date().toISOString(),
		assistantApiUrl: apiUrl,
		sourceDataset: path.relative(process.cwd(), input) || input,
		datasetRowCount: allRows.length,
		evaluatedRowCount: mergedResults.length,
		options: {
			offset,
			limit: limit ?? null,
			delayMsBetweenCalls: delayMs,
			retriesPerQuery: retries,
			cacheEnabled: useCache,
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
