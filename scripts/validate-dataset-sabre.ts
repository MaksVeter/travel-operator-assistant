#!/usr/bin/env bun
/**
 * Reads `data/validation-dataset.json`, collects unique `command` values (first-seen order),
 * validates each via Sabre (validateSabreHostCommand = LLS + IgnoreTransaction).
 * Mileage `W/-ATXXX≠ATYYY` is sent to SOAP as `W/-ATXXX ATYYY` (only `≠` → space); stored `command` in output is unchanged.
 * Output: validTechnical = SOAP OK + no host **technical** screen (INVALID_*, FORMAT/INVLD);
 * validSemantic = validTechnical + no **semantic** screen (lookup, context, ERR, busy, …).
 *
 * **Revalidate** (`--revalidate`): reloads an existing results JSON (same host screens, no Sabre calls),
 * reapplies `describeHostScreenTechnicalRejection` / `describeHostScreenSemanticRejection`, overwrites `--out`
 * (default: same file as `--in`). Full `screen` text is stored on live runs so revalidation matches Sabre output;
 * if only `screenPreview` exists (legacy), rules run on that truncated text.
 *
 * **Redo invalid technical** (`--redo-invalid-technical`): reads `--in` results JSON (default: `data/sabre-validation-results.json`),
 * re-calls Sabre only for rows where `validTechnical` is false, merges back in original order, writes `--out` (default: same as `--in`).
 * Uses the same API transforms as a live run (e.g. mileage `≠` → space).
 *
 * **Cache** (live mode only): if `--out` already exists and contains a `results[]` row for a command, that row is
 * reused and Sabre is not called. Delay applies only between consecutive Sabre calls. `--no-cache` disables reads.
 *
 * Usage (from travel-operator-assistant, root .env with SABRE_*):
 *   bun run validate:dataset-sabre
 *   bun run scripts/validate-dataset-sabre.ts --in ./data/validation-dataset.json --out ./data/sabre-validation-results.json
 *   bun run scripts/validate-dataset-sabre.ts --revalidate
 *   bun run scripts/validate-dataset-sabre.ts --revalidate --in ./data/sabre-validation-results.json --out ./data/sabre-validation-results.json
 *   bun run scripts/validate-dataset-sabre.ts --redo-invalid-technical --in ./data/sabre-validation-results.json
 *   bun run scripts/validate-dataset-sabre.ts --delay 3000 --retries 4
 *   bun run scripts/validate-dataset-sabre.ts --limit 50   # smoke test
 *   bun run scripts/validate-dataset-sabre.ts --no-cache   # ignore existing results file
 */

import fs from "node:fs";
import path from "node:path";
import { loadSabreConfig } from "../packages/sabre-command/src/config.ts";
import {
	describeHostScreenSemanticRejection,
	describeHostScreenTechnicalRejection,
} from "../packages/sabre-command/src/host-screen-semantic.ts";
import {
	type ValidateCommandResult,
	validateSabreHostCommand,
} from "../packages/sabre-command/src/sabre-soap.ts";

type DatasetRow = {
	query: string;
	intent: string;
	command: string;
	dsl_signature?: string;
};

type CliResult = {
	command: string;
	validTechnical: boolean;
	validSemantic: boolean;
	technicalReason: string | null;
	semanticReason: string | null;
	error: string | null;
	screenLength: number | null;
	/** Full host screen when captured from Sabre (needed for accurate `--revalidate`). */
	screen: string | null;
	screenPreview: string | null;
};

type SabreReportFile = {
	generatedAt?: string;
	revalidatedAt?: string;
	redidInvalidTechnicalAt?: string;
	sabreSoapUrl?: string;
	sourceDataset?: string;
	datasetRowCount?: number;
	uniqueCommandCount?: number;
	options?: Record<string, unknown>;
	summary?: Record<string, unknown>;
	results: unknown[];
};

function parseArgs(argv: string[]) {
	const cwd = process.cwd();
	const defaultDataset = path.join(cwd, "data", "validation-dataset.json");
	const defaultResults = path.join(cwd, "data", "sabre-validation-results.json");
	let revalidate = false;
	let redoInvalidTechnical = false;
	let input = defaultDataset;
	let output = defaultResults;
	let delayMs = 2500;
	let retries = 4;
	let limit: number | undefined;
	let useCache = true;

	for (let i = 2; i < argv.length; i++) {
		const a = argv[i];
		const take = () => {
			const v = argv[++i];
			if (!v) throw new Error(`Missing value after ${a}`);
			return v;
		};
		if (a === "--revalidate") {
			revalidate = true;
		} else if (a === "--redo-invalid-technical") {
			redoInvalidTechnical = true;
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
		}
	}

	if (revalidate) {
		if (input === defaultDataset) {
			input = defaultResults;
		}
		if (output === defaultResults && input !== defaultResults) {
			output = input;
		}
		if (output === defaultDataset) {
			output = defaultResults;
		}
	}

	if (redoInvalidTechnical) {
		if (input === defaultDataset) {
			input = defaultResults;
		}
		if (output === defaultResults) {
			output = input;
		}
	}

	return {
		revalidate,
		redoInvalidTechnical,
		input,
		output,
		delayMs,
		retries,
		limit,
		useCache,
	};
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

function previewScreen(s: string | undefined, max = 160): string | null {
	if (!s) return null;
	const one = s.replace(/\s+/g, " ").trim();
	return one.length <= max ? one : `${one.slice(0, max)}…`;
}

function isRetryableSabreError(msg: string): boolean {
	const u = msg.toUpperCase();
	return (
		u.includes("RETRY LATER") ||
		u.includes("ALL HOST LINE ACTIVE") ||
		u.includes("TIMEOUT") ||
		u.includes("ECONNRESET") ||
		u.includes("FETCH FAILED")
	);
}

/** U+2260 — dataset/chunks mileage separator; not accepted as-is over SabreCommandLLSRQ. */
const DATASET_DISTANCE_SEP = "\u2260";

/**
 * Command string sent to Sabre SOAP only. Dataset `command` stays unchanged (e.g. keeps `≠`).
 * Mileage-between-airports: `W/-ATXXX≠ATYYY` → `W/-ATXXX ATYYY` (space instead of `≠`).
 */
function commandForSabreApiRequest(command: string): string {
	const c = command.trim();
	if (/^W\/-AT[A-Z0-9]{3}\u2260AT[A-Z0-9]{3}$/i.test(c)) {
		return c.replace(DATASET_DISTANCE_SEP, " ");
	}
	return command;
}

function applyRulesFromScreen(
	screen: string | null | undefined,
	error: string | null,
): Pick<
	CliResult,
	"validTechnical" | "validSemantic" | "technicalReason" | "semanticReason"
> {
	if (error !== null && error !== undefined && error !== "") {
		return {
			validTechnical: false,
			validSemantic: false,
			technicalReason: null,
			semanticReason: null,
		};
	}
	const technicalReason = describeHostScreenTechnicalRejection(screen);
	if (technicalReason !== null) {
		return {
			validTechnical: false,
			validSemantic: false,
			technicalReason,
			semanticReason: null,
		};
	}
	const semanticReason = describeHostScreenSemanticRejection(screen);
	return {
		validTechnical: true,
		validSemantic: semanticReason === null,
		technicalReason: null,
		semanticReason,
	};
}

function isRecord(x: unknown): x is Record<string, unknown> {
	return typeof x === "object" && x !== null && !Array.isArray(x);
}

function revalidateRow(raw: unknown): CliResult {
	if (!isRecord(raw) || typeof raw.command !== "string") {
		throw new Error("Each result entry must be an object with a string command");
	}
	const command = raw.command;
	const errNorm: string | null =
		raw.error === null || raw.error === undefined
			? null
			: typeof raw.error === "string"
				? raw.error
				: String(raw.error);

	const screen =
		typeof raw.screen === "string"
			? raw.screen
			: raw.screen === null
				? null
				: undefined;
	const screenPreviewRaw =
		typeof raw.screenPreview === "string"
			? raw.screenPreview
			: raw.screenPreview === null
				? null
				: undefined;

	const screenForRules = screen ?? screenPreviewRaw ?? null;
	const rules = applyRulesFromScreen(screenForRules, errNorm);

	const screenLength =
		typeof raw.screenLength === "number"
			? raw.screenLength
			: screenForRules != null
				? screenForRules.length
				: null;

	const screenOut = screen ?? null;
	const screenPreview =
		screenOut != null
			? previewScreen(screenOut)
			: (screenPreviewRaw ?? previewScreen(screenForRules ?? undefined));

	return {
		command,
		validTechnical: rules.validTechnical,
		validSemantic: rules.validSemantic,
		technicalReason: rules.technicalReason,
		semanticReason: rules.semanticReason,
		error: errNorm,
		screenLength,
		screen: screenOut,
		screenPreview,
	};
}

function readStringOrNull(v: unknown): string | null {
	if (v === null || v === undefined) return null;
	if (typeof v === "string") return v;
	return String(v);
}

/**
 * Parse a stored `results[]` row for live-run cache reuse (no Sabre call).
 * Returns null if the row cannot be interpreted as a cached validation.
 */
function cacheEntryToCliResult(raw: unknown): CliResult | null {
	if (!isRecord(raw) || typeof raw.command !== "string") return null;
	const command = raw.command.trim();
	if (!command) return null;

	const errNorm: string | null =
		raw.error === null || raw.error === undefined
			? null
			: typeof raw.error === "string"
				? raw.error
				: String(raw.error);

	const hasPair =
		typeof raw.validTechnical === "boolean" && typeof raw.validSemantic === "boolean";

	let validTechnical: boolean;
	let validSemantic: boolean;
	let technicalReason: string | null;
	let semanticReason: string | null;

	if (hasPair) {
		validTechnical = raw.validTechnical as boolean;
		validSemantic = raw.validSemantic as boolean;
		technicalReason = readStringOrNull(raw.technicalReason);
		semanticReason = readStringOrNull(raw.semanticReason);
	} else if (typeof raw.valid === "boolean") {
		validTechnical = raw.valid;
		validSemantic = raw.valid;
		technicalReason = null;
		semanticReason = null;
	} else {
		return null;
	}

	const screen = typeof raw.screen === "string" ? raw.screen : null;
	const screenPreviewRaw = readStringOrNull(raw.screenPreview);

	const screenLength =
		typeof raw.screenLength === "number" && Number.isFinite(raw.screenLength)
			? raw.screenLength
			: screen != null
				? screen.length
				: null;

	const screenPreview =
		screen != null ? previewScreen(screen) : (screenPreviewRaw ?? null);

	return {
		command,
		validTechnical,
		validSemantic,
		technicalReason,
		semanticReason,
		error: errNorm,
		screenLength,
		screen,
		screenPreview,
	};
}

function loadResultsCache(filePath: string): Map<string, CliResult> {
	const map = new Map<string, CliResult>();
	if (!fs.existsSync(filePath)) return map;
	let parsed: SabreReportFile;
	try {
		parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as SabreReportFile;
	} catch {
		return map;
	}
	if (!parsed?.results || !Array.isArray(parsed.results)) return map;
	for (const row of parsed.results) {
		const c = cacheEntryToCliResult(row);
		if (c) map.set(c.command, c);
	}
	return map;
}

function buildSummary(results: CliResult[], elapsedMs: number) {
	const validTechnical = results.filter((r) => r.validTechnical).length;
	const invalidTechnical = results.length - validTechnical;
	const validSemantic = results.filter((r) => r.validSemantic).length;
	const invalidSemantic = results.length - validSemantic;
	const invalidSoap = results.filter((r) => r.error !== null).length;
	const invalidTechnicalScreen = results.filter(
		(r) => !r.validTechnical && r.error === null && r.technicalReason !== null,
	).length;
	return {
		validTechnical,
		invalidTechnical,
		validTechnicalRate: results.length
			? Math.round((1000 * validTechnical) / results.length) / 10
			: 0,
		invalidTechnicalSoap: invalidSoap,
		invalidTechnicalScreen,
		validSemantic,
		invalidSemantic,
		validSemanticRate: results.length
			? Math.round((1000 * validSemantic) / results.length) / 10
			: 0,
		elapsedMs,
	};
}

function printReportFooter(
	results: CliResult[],
	elapsedMs: number,
	output: string,
	label: string,
) {
	const validTechnical = results.filter((r) => r.validTechnical).length;
	const invalidSoap = results.filter((r) => r.error !== null).length;
	const invalidTechnicalScreen = results.filter(
		(r) => !r.validTechnical && r.error === null && r.technicalReason !== null,
	).length;
	const validSemantic = results.filter((r) => r.validSemantic).length;

	console.log(`\n--- Sabre validation (${label}) ---`);
	console.log(`unique commands:    ${results.length}`);
	console.log(`valid (technical):  ${validTechnical} / ${results.length} (${results.length ? ((100 * validTechnical) / results.length).toFixed(1) : "0"}%)`);
	console.log(`invalid (SOAP/etc.): ${invalidSoap}`);
	console.log(`invalid (host tech.): ${invalidTechnicalScreen}`);
	console.log(`valid (semantic):     ${validSemantic} / ${results.length} (${results.length ? ((100 * validSemantic) / results.length).toFixed(1) : "0"}%)`);
	console.log(`elapsed:            ${(elapsedMs / 1000).toFixed(1)}s`);
	console.log(`written:            ${output}`);
	if (validTechnical < results.length) {
		const sample = results.filter((r) => !r.validTechnical).slice(0, 8);
		console.log("\nfirst technical-invalid samples:");
		for (const r of sample) {
			const detail =
				r.error !== null
					? `SOAP: ${r.error?.slice(0, 120) ?? "?"}`
					: `host: ${r.technicalReason ?? "?"}`;
			console.log(`  ${r.command.slice(0, 72)} → ${detail}`);
		}
	}
	const semBad = results.filter((r) => r.validTechnical && !r.validSemantic);
	if (semBad.length > 0) {
		console.log("\nfirst semantic-invalid (technical OK) samples:");
		for (const r of semBad.slice(0, 8)) {
			console.log(
				`  ${r.command.slice(0, 72)} → ${r.semanticReason ?? "?"} | ${r.screenPreview?.slice(0, 100) ?? ""}`,
			);
		}
	}
}

async function validateWithRetry(
	cfg: ReturnType<typeof loadSabreConfig>,
	command: string,
	retries: number,
	retryDelayMs: number,
): Promise<ValidateCommandResult> {
	let last: ValidateCommandResult = {
		validTechnical: false,
		validSemantic: false,
		technicalReason: null,
		semanticReason: null,
		error: "no attempt",
		screen: undefined,
	};
	for (let attempt = 0; attempt < retries; attempt++) {
		if (attempt > 0) await sleep(retryDelayMs);
		last = await validateSabreHostCommand(cfg, commandForSabreApiRequest(command));
		if (last.validTechnical) return last;
		const err = last.error ?? "";
		if (!isRetryableSabreError(err)) return last;
	}
	return last;
}

async function runLiveValidation(
	input: string,
	output: string,
	delayMs: number,
	retries: number,
	limit: number | undefined,
	useCache: boolean,
) {
	const raw = fs.readFileSync(input, "utf8");
	const rows = JSON.parse(raw) as DatasetRow[];
	if (!Array.isArray(rows)) {
		throw new Error("Dataset must be a JSON array");
	}

	const seen = new Set<string>();
	const uniqueCommands: string[] = [];
	for (const r of rows) {
		const c = r.command?.trim();
		if (!c || seen.has(c)) continue;
		seen.add(c);
		uniqueCommands.push(c);
		if (limit !== undefined && uniqueCommands.length >= limit) break;
	}

	const cache = useCache ? loadResultsCache(output) : new Map<string, CliResult>();
	if (useCache && cache.size > 0) {
		console.error(`cache: loaded ${cache.size} command(s) from ${output}`);
	}
	const cfg = loadSabreConfig();
	const started = Date.now();
	const results: CliResult[] = [];
	let fromCache = 0;
	let fromSabre = 0;
	let lastWasSabre = false;

	for (let i = 0; i < uniqueCommands.length; i++) {
		const command = uniqueCommands[i]!;
		const hit = cache.get(command);
		if (hit) {
			results.push(hit);
			fromCache++;
			lastWasSabre = false;
		} else {
			if (lastWasSabre && delayMs > 0) await sleep(delayMs);
			const v = await validateWithRetry(cfg, command, retries, 3500);
			const screen = v.screen;
			const semanticReason = v.semanticReason ?? null;
			const technicalReason = v.technicalReason ?? null;
			results.push({
				command,
				validTechnical: v.validTechnical,
				validSemantic: v.validSemantic,
				technicalReason,
				semanticReason,
				error: v.error ?? null,
				screenLength: screen ? screen.length : null,
				screen: screen ?? null,
				screenPreview: previewScreen(screen),
			});
			fromSabre++;
			lastWasSabre = true;
		}

		if ((i + 1) % 25 === 0 || i === uniqueCommands.length - 1) {
			const src = hit ? "cache" : "Sabre";
			console.log(`progress ${i + 1}/${uniqueCommands.length} [${src}] (${command.slice(0, 48)}…)`);
		}
	}

	const elapsedMs = Date.now() - started;
	const report = {
		generatedAt: new Date().toISOString(),
		sabreSoapUrl: cfg.soapUrl,
		sourceDataset: path.relative(process.cwd(), input) || input,
		datasetRowCount: rows.length,
		uniqueCommandCount: results.length,
		options: {
			delayMsBetweenCommands: delayMs,
			retriesPerCommand: retries,
			cacheEnabled: useCache,
			resultsFromCache: fromCache,
			resultsFromSabre: fromSabre,
		},
		summary: buildSummary(results, elapsedMs),
		results,
	};

	fs.mkdirSync(path.dirname(output), { recursive: true });
	fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");

	console.log("\n--- Sabre validation (unique commands) ---");
	console.log(`dataset rows:       ${rows.length}`);
	if (useCache) {
		console.log(`cache (--out):      ${fromCache} reused, ${fromSabre} Sabre calls`);
	}
	printReportFooter(results, elapsedMs, output, "live Sabre");
}

async function runRedoInvalidTechnical(
	input: string,
	output: string,
	delayMs: number,
	retries: number,
) {
	const raw = fs.readFileSync(input, "utf8");
	const parsed = JSON.parse(raw) as SabreReportFile;
	if (!parsed?.results || !Array.isArray(parsed.results)) {
		throw new Error("Results file must contain results[]");
	}

	const previous: CliResult[] = parsed.results.map((row) => {
		const c = cacheEntryToCliResult(row);
		return c ?? revalidateRow(row);
	});

	const toRetry = previous.filter((r) => !r.validTechnical).length;
	console.error(
		`redo-invalid-technical: ${toRetry} of ${previous.length} row(s) will be re-sent to Sabre`,
	);

	const cfg = loadSabreConfig();
	const started = Date.now();
	const results: CliResult[] = [];
	let sabreCalls = 0;
	let lastWasSabre = false;

	for (let i = 0; i < previous.length; i++) {
		const old = previous[i]!;
		if (old.validTechnical) {
			results.push(old);
			lastWasSabre = false;
			continue;
		}
		if (lastWasSabre && delayMs > 0) await sleep(delayMs);
		const v = await validateWithRetry(cfg, old.command, retries, 3500);
		const screen = v.screen;
		results.push({
			command: old.command,
			validTechnical: v.validTechnical,
			validSemantic: v.validSemantic,
			technicalReason: v.technicalReason ?? null,
			semanticReason: v.semanticReason ?? null,
			error: v.error ?? null,
			screenLength: screen ? screen.length : null,
			screen: screen ?? null,
			screenPreview: previewScreen(screen),
		});
		sabreCalls++;
		lastWasSabre = true;
		console.error(
			`progress Sabre ${sabreCalls}/${toRetry} (${old.command.slice(0, 64)})`,
		);
	}

	const elapsedMs = Date.now() - started;
	const baseOpts =
		typeof parsed.options === "object" && parsed.options !== null && !Array.isArray(parsed.options)
			? parsed.options
			: {};
	const report = {
		...parsed,
		redidInvalidTechnicalAt: new Date().toISOString(),
		uniqueCommandCount: results.length,
		options: {
			...baseOpts,
			redoInvalidTechnicalSabreCalls: sabreCalls,
			redoInvalidTechnicalElapsedMs: elapsedMs,
		},
		summary: buildSummary(results, elapsedMs),
		results,
	};

	fs.mkdirSync(path.dirname(output), { recursive: true });
	fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");

	printReportFooter(results, elapsedMs, output, "redo invalid technical");
}

function runRevalidate(input: string, output: string) {
	const raw = fs.readFileSync(input, "utf8");
	const parsed = JSON.parse(raw) as SabreReportFile;
	if (!parsed || !Array.isArray(parsed.results)) {
		throw new Error("Results file must be an object with a results array");
	}

	const started = Date.now();
	const results = parsed.results.map((row) => revalidateRow(row));
	const elapsedMs = Date.now() - started;

	const report = {
		...parsed,
		revalidatedAt: new Date().toISOString(),
		uniqueCommandCount: results.length,
		summary: buildSummary(results, elapsedMs),
		results,
	};

	fs.mkdirSync(path.dirname(output), { recursive: true });
	fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");

	printReportFooter(results, elapsedMs, output, "revalidate from JSON");
}

async function main() {
	const {
		revalidate,
		redoInvalidTechnical,
		input,
		output,
		delayMs,
		retries,
		limit,
		useCache,
	} = parseArgs(process.argv);
	if (revalidate && redoInvalidTechnical) {
		throw new Error("Use either --revalidate or --redo-invalid-technical, not both");
	}
	if (revalidate) {
		runRevalidate(input, output);
	} else if (redoInvalidTechnical) {
		await runRedoInvalidTechnical(input, output, delayMs, retries);
	} else {
		await runLiveValidation(input, output, delayMs, retries, limit, useCache);
	}
}

await main();
