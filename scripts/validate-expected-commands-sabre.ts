#!/usr/bin/env bun
/**
 * Validate expected commands from `data/expected-commands.json` via Sabre SOAP API.
 *
 * - `reference` entries: single command validated independently.
 * - `multi_turn` entries: all turns run sequentially in the **same** Sabre session,
 *   so context-dependent follow-up commands (e.g. `1‡3` after an availability request)
 *   are validated with the correct session state.
 *
 * Optionally writes a filtered copy with only valid entries (--filter).
 *
 * Character handling (from validate-dataset-sabre.ts):
 *   - Mileage `W/-ATXXX≠ATYYY` → `W/-ATXXX ATYYY` (≠ → space) for SOAP
 *
 * Usage:
 *   bun run scripts/validate-expected-commands-sabre.ts
 *   bun run scripts/validate-expected-commands-sabre.ts --limit 10
 *   bun run scripts/validate-expected-commands-sabre.ts --filter
 *   bun run scripts/validate-expected-commands-sabre.ts --no-cache --delay 3000
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
	runSabreHostCommandSequence,
	validateSabreHostCommand,
} from "../packages/sabre-command/src/sabre-soap.ts";

// ── Types ──

type TurnEntry = {
	expected_command: string;
	expected_signature: string;
};

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
	turns: TurnEntry[];
};

type ExpectedCommandEntry = ReferenceEntry | MultiTurnEntry;

type TurnResult = {
	command: string;
	validTechnical: boolean;
	validSemantic: boolean;
	technicalReason: string | null;
	semanticReason: string | null;
	error: string | null;
	screenPreview: string | null;
};

type EntryResult = {
	index: number;
	intent: string;
	type: "reference" | "multi_turn";
	category: string;
	valid: boolean;
	turns: TurnResult[];
};

type ReportFile = {
	generatedAt?: string;
	results: EntryResult[];
};

// ── Helpers ──

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

/** U+2260 — mileage separator; not accepted as-is over SabreCommandLLSRQ. */
const DATASET_DISTANCE_SEP = "\u2260";

function commandForSabreApi(command: string): string {
	const c = command.trim();
	if (/^W\/-AT[A-Z0-9]{3}\u2260AT[A-Z0-9]{3}$/i.test(c)) {
		return c.replace(DATASET_DISTANCE_SEP, " ");
	}
	return command;
}

// ── Cache ──

function loadResultsCache(filePath: string): Map<number, EntryResult> {
	const map = new Map<number, EntryResult>();
	if (!fs.existsSync(filePath)) return map;
	try {
		const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as ReportFile;
		if (!parsed?.results || !Array.isArray(parsed.results)) return map;
		for (const row of parsed.results) {
			if (typeof row.index === "number") {
				map.set(row.index, row);
			}
		}
	} catch {
		/* ignore corrupt cache */
	}
	return map;
}

// ── Validation: reference (single command, own session) ──

async function validateReference(
	cfg: ReturnType<typeof loadSabreConfig>,
	entry: ReferenceEntry,
	retries: number,
	retryDelayMs: number,
): Promise<TurnResult> {
	let last: ValidateCommandResult | null = null;
	for (let attempt = 0; attempt < retries; attempt++) {
		if (attempt > 0) await sleep(retryDelayMs);
		last = await validateSabreHostCommand(cfg, commandForSabreApi(entry.expected_command));
		if (last.validTechnical) break;
		const err = last.error ?? "";
		if (!isRetryableSabreError(err)) break;
	}
	const v = last!;
	return {
		command: entry.expected_command,
		validTechnical: v.validTechnical,
		validSemantic: v.validSemantic,
		technicalReason: v.technicalReason ?? null,
		semanticReason: v.semanticReason ?? null,
		error: v.error ?? null,
		screenPreview: previewScreen(v.screen),
	};
}

// ── Validation: multi_turn (all turns in one session) ──

async function validateMultiTurn(
	cfg: ReturnType<typeof loadSabreConfig>,
	entry: MultiTurnEntry,
	retries: number,
	retryDelayMs: number,
): Promise<TurnResult[]> {
	const commands = entry.turns.map((t) => commandForSabreApi(t.expected_command));

	for (let attempt = 0; attempt < retries; attempt++) {
		if (attempt > 0) await sleep(retryDelayMs);
		try {
			const sabreResults = await runSabreHostCommandSequence(cfg, commands, {
				discardTransaction: true,
			});

			return entry.turns.map((turn, i) => {
				const screen = sabreResults[i]?.screen;
				const technicalReason = describeHostScreenTechnicalRejection(screen);
				if (technicalReason !== null) {
					return {
						command: turn.expected_command,
						validTechnical: false,
						validSemantic: false,
						technicalReason,
						semanticReason: null,
						error: null,
						screenPreview: previewScreen(screen),
					};
				}
				const semanticReason = describeHostScreenSemanticRejection(screen);
				return {
					command: turn.expected_command,
					validTechnical: true,
					validSemantic: semanticReason === null,
					technicalReason: null,
					semanticReason: semanticReason ?? null,
					error: null,
					screenPreview: previewScreen(screen),
				};
			});
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			if (!isRetryableSabreError(msg)) {
				return entry.turns.map((turn) => ({
					command: turn.expected_command,
					validTechnical: false,
					validSemantic: false,
					technicalReason: null,
					semanticReason: null,
					error: msg,
					screenPreview: null,
				}));
			}
		}
	}

	return entry.turns.map((turn) => ({
		command: turn.expected_command,
		validTechnical: false,
		validSemantic: false,
		technicalReason: null,
		semanticReason: null,
		error: "max retries exhausted",
		screenPreview: null,
	}));
}

// ── CLI args ──

function parseArgs(argv: string[]) {
	const cwd = process.cwd();
	let input = path.join(cwd, "data", "expected-commands.json");
	let output = path.join(cwd, "data", "expected-commands-sabre-validation.json");
	let delayMs = 2500;
	let retries = 4;
	let limit: number | undefined;
	let useCache = true;
	let filter = false;

	for (let i = 2; i < argv.length; i++) {
		const a = argv[i];
		const take = () => {
			const v = argv[++i];
			if (!v) throw new Error(`Missing value after ${a}`);
			return v;
		};
		if (a === "--no-cache") useCache = false;
		else if (a === "--filter") filter = true;
		else if (a === "--in" && argv[i + 1]) input = path.resolve(take());
		else if (a === "--out" && argv[i + 1]) output = path.resolve(take());
		else if (a === "--delay" && argv[i + 1])
			delayMs = Math.max(0, Number.parseInt(take(), 10) || 0);
		else if (a === "--retries" && argv[i + 1])
			retries = Math.max(1, Number.parseInt(take(), 10) || 1);
		else if (a === "--limit" && argv[i + 1])
			limit = Math.max(1, Number.parseInt(take(), 10) || 1);
	}

	return { input, output, delayMs, retries, limit, useCache, filter };
}

// ── Main ──

async function main() {
	const args = parseArgs(process.argv);

	const entries = JSON.parse(
		fs.readFileSync(args.input, "utf8"),
	) as ExpectedCommandEntry[];

	let toProcess = entries.map((e, i) => ({ entry: e, index: i }));
	if (args.limit !== undefined) {
		toProcess = toProcess.slice(0, args.limit);
	}

	console.log(
		`Loaded ${entries.length} entries, processing ${toProcess.length}` +
			` (${toProcess.filter((e) => e.entry.type === "reference").length} reference,` +
			` ${toProcess.filter((e) => e.entry.type === "multi_turn").length} multi_turn)`,
	);

	const cache = args.useCache
		? loadResultsCache(args.output)
		: new Map<number, EntryResult>();
	if (args.useCache && cache.size > 0) {
		console.log(`Cache: ${cache.size} entry result(s) from ${path.basename(args.output)}`);
	}

	const cfg = loadSabreConfig();
	const started = Date.now();
	const results: EntryResult[] = [];
	let fromCache = 0;
	let fromSabre = 0;

	for (let i = 0; i < toProcess.length; i++) {
		const { entry, index } = toProcess[i]!;

		const hit = cache.get(index);
		if (hit) {
			results.push(hit);
			fromCache++;
		} else {
			if (fromSabre > 0 && args.delayMs > 0) await sleep(args.delayMs);

			let turns: TurnResult[];
			if (entry.type === "reference") {
				const r = await validateReference(cfg, entry, args.retries, 3500);
				turns = [r];
			} else {
				turns = await validateMultiTurn(cfg, entry, args.retries, 3500);
			}

			const allTechValid = turns.every((t) => t.validTechnical);
			results.push({
				index,
				intent: entry.intent,
				type: entry.type,
				category: entry.category,
				valid: allTechValid,
				turns,
			});
			fromSabre++;
		}

		const label =
			entry.type === "reference"
				? (entry as ReferenceEntry).expected_command
				: (entry as MultiTurnEntry).turns.map((t) => t.expected_command).join(" → ");

		if ((i + 1) % 5 === 0 || i === toProcess.length - 1) {
			const src = hit ? "cache" : "Sabre";
			console.log(
				`[${i + 1}/${toProcess.length}] [${src}] ${entry.type} ${entry.intent}: ${label.slice(0, 60)}`,
			);
		}
	}

	const elapsedMs = Date.now() - started;

	// ── Summary stats ──
	const validEntries = results.filter((r) => r.valid).length;
	const invalidEntries = results.length - validEntries;

	const allTurns = results.flatMap((r) => r.turns);
	const validTechTurns = allTurns.filter((t) => t.validTechnical).length;
	const validSemTurns = allTurns.filter((t) => t.validSemantic).length;
	const soapErrors = allTurns.filter((t) => t.error !== null).length;

	const pct = (n: number, total: number) =>
		total ? Math.round((1000 * n) / total) / 10 : 0;

	const report = {
		generatedAt: new Date().toISOString(),
		sabreSoapUrl: cfg.soapUrl,
		sourceFile: path.relative(process.cwd(), args.input) || args.input,
		totalEntries: entries.length,
		processedEntries: toProcess.length,
		options: {
			delayMs: args.delayMs,
			retries: args.retries,
			cacheEnabled: args.useCache,
			fromCache,
			fromSabre,
		},
		summary: {
			validEntries,
			invalidEntries,
			validEntryRate: pct(validEntries, results.length),
			totalTurns: allTurns.length,
			validTechnicalTurns: validTechTurns,
			validTechnicalTurnRate: pct(validTechTurns, allTurns.length),
			validSemanticTurns: validSemTurns,
			validSemanticTurnRate: pct(validSemTurns, allTurns.length),
			soapErrors,
			elapsedMs,
		},
		results,
	};

	fs.mkdirSync(path.dirname(args.output), { recursive: true });
	fs.writeFileSync(args.output, `${JSON.stringify(report, null, 2)}\n`, "utf8");

	// ── Print ──
	console.log("\n--- Expected commands Sabre validation ---");
	console.log(`Entries processed:   ${results.length}`);
	if (args.useCache)
		console.log(`Cache / Sabre calls: ${fromCache} / ${fromSabre}`);
	console.log(
		`Valid entries:       ${validEntries} / ${results.length} (${report.summary.validEntryRate}%)`,
	);
	console.log(
		`Turns tech-valid:    ${validTechTurns} / ${allTurns.length} (${report.summary.validTechnicalTurnRate}%)`,
	);
	console.log(
		`Turns sem-valid:     ${validSemTurns} / ${allTurns.length} (${report.summary.validSemanticTurnRate}%)`,
	);
	console.log(`SOAP errors:         ${soapErrors}`);
	console.log(`Elapsed:             ${(elapsedMs / 1000).toFixed(1)}s`);
	console.log(`Written:             ${args.output}`);

	// Show invalid entries
	const invalids = results.filter((r) => !r.valid);
	if (invalids.length > 0) {
		console.log(`\nInvalid entries (${invalids.length}):`);
		for (const r of invalids.slice(0, 20)) {
			const failedTurns = r.turns.filter((t) => !t.validTechnical);
			for (const t of failedTurns) {
				const detail =
					t.error !== null
						? `SOAP: ${t.error.slice(0, 100)}`
						: `host: ${t.technicalReason ?? "?"}`;
				console.log(
					`  [${r.type}] ${r.intent.padEnd(40)} ${t.command.padEnd(25)} ${detail}`,
				);
			}
		}
		if (invalids.length > 20) console.log(`  ... and ${invalids.length - 20} more`);
	}

	// Semantic-only failures
	const semOnly = results.filter(
		(r) => r.valid && r.turns.some((t) => !t.validSemantic),
	);
	if (semOnly.length > 0) {
		console.log(`\nSemantic failures (tech OK) — ${semOnly.length} entries:`);
		for (const r of semOnly.slice(0, 15)) {
			for (const t of r.turns.filter((t) => !t.validSemantic)) {
				console.log(
					`  ${r.intent.padEnd(40)} ${t.command.padEnd(25)} ${t.semanticReason ?? "?"} | ${t.screenPreview?.slice(0, 60) ?? ""}`,
				);
			}
		}
		if (semOnly.length > 15) console.log(`  ... and ${semOnly.length - 15} more`);
	}

	// ── Filter mode ──
	if (args.filter) {
		const invalidIndices = new Set(
			results.filter((r) => !r.valid).map((r) => r.index),
		);

		if (invalidIndices.size === 0) {
			console.log("\nAll entries are technically valid, no filtering needed.");
		} else {
			const filtered = entries.filter((_, i) => !invalidIndices.has(i));
			const filteredPath = args.input.replace(/\.json$/, "-validated.json");
			fs.writeFileSync(
				filteredPath,
				`${JSON.stringify(filtered, null, 2)}\n`,
				"utf8",
			);
			console.log(
				`\nFiltered: removed ${invalidIndices.size} entries with invalid commands`,
			);
			console.log(`Remaining: ${filtered.length} entries`);
			console.log(`Written:   ${filteredPath}`);
		}
	}
}

await main();
