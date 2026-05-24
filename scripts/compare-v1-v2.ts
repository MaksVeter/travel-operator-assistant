#!/usr/bin/env bun
/**
 * Compare V1 and V2 assistant evaluation results side-by-side.
 *
 * Usage (from travel-operator-assistant):
 *   bun run scripts/compare-v1-v2.ts
 *   bun run scripts/compare-v1-v2.ts --v1 data/assistant-eval-results.json --v2 data/assistant-eval-results-v2-translate.json
 */

import fs from "node:fs";
import path from "node:path";

type EvalReport = {
	generatedAt?: string;
	assistantApiUrl?: string;
	evaluatedRowCount?: number;
	summary?: {
		evaluated?: number;
		exactMatch?: number;
		exactMatchRate?: number;
		signatureMatch?: number;
		signatureMatchRate?: number;
		refusals?: number;
		unexpectedRefusals?: number;
		apiErrors?: number;
		byIntent?: Record<
			string,
			{ total: number; exactMatch: number; signatureMatch: number; exactMatchRate: number }
		>;
	};
	results?: Array<{
		query: string;
		intent: string;
		expectedCommand: string;
		predictedCommand: string | null;
		exactMatch: boolean;
		signatureMatch: boolean;
		refusal: boolean;
	}>;
};

function parseArgs(argv: string[]) {
	const cwd = process.cwd();
	let v1Path = path.join(cwd, "data", "assistant-eval-results.json");
	let v2Path = path.join(cwd, "data", "assistant-eval-results-v2-translate.json");

	for (let i = 2; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--v1" && argv[i + 1]) v1Path = path.resolve(argv[++i]!);
		if (a === "--v2" && argv[i + 1]) v2Path = path.resolve(argv[++i]!);
	}

	return { v1Path, v2Path };
}

function loadReport(filePath: string): EvalReport | null {
	if (!fs.existsSync(filePath)) {
		console.error(`File not found: ${filePath}`);
		return null;
	}
	return JSON.parse(fs.readFileSync(filePath, "utf8")) as EvalReport;
}

function main() {
	const { v1Path, v2Path } = parseArgs(process.argv);

	const v1 = loadReport(v1Path);
	const v2 = loadReport(v2Path);

	if (!v1 || !v2) {
		console.error("\nCannot compare — one or both result files missing.");
		console.error("Run evaluations first:");
		console.error("  bun run evaluate:assistant");
		console.error("  bun run evaluate:v2");
		process.exit(1);
	}

	const s1 = v1.summary;
	const s2 = v2.summary;

	console.log("\n╔══════════════════════════════════════════════════════╗");
	console.log("║          V1 vs V2 Evaluation Comparison             ║");
	console.log("╠══════════════════════════════════════════════════════╣");
	console.log(`║ Metric              │    V1      │    V2      │ Δ    ║`);
	console.log("╠═════════════════════╪════════════╪════════════╪══════╣");

	const rows: [string, number | undefined, number | undefined][] = [
		["Evaluated", s1?.evaluated, s2?.evaluated],
		["Exact Match %", s1?.exactMatchRate, s2?.exactMatchRate],
		["Signature Match %", s1?.signatureMatchRate, s2?.signatureMatchRate],
		["Refusals", s1?.refusals, s2?.refusals],
		["Unexpected Refusals", s1?.unexpectedRefusals, s2?.unexpectedRefusals],
		["API Errors", s1?.apiErrors, s2?.apiErrors],
	];

	for (const [label, val1, val2] of rows) {
		const v1s = val1 !== undefined ? String(val1).padStart(8) : "     N/A";
		const v2s = val2 !== undefined ? String(val2).padStart(8) : "     N/A";
		const delta =
			val1 !== undefined && val2 !== undefined
				? (val2 - val1 >= 0 ? "+" : "") + (val2 - val1).toFixed(1)
				: "  —";
		console.log(
			`║ ${label.padEnd(19)} │ ${v1s}   │ ${v2s}   │${delta.padStart(5)} ║`,
		);
	}

	console.log("╚══════════════════════════════════════════════════════╝");

	// Per-intent comparison if both have byIntent data
	if (s1?.byIntent && s2?.byIntent) {
		const allIntents = new Set([
			...Object.keys(s1.byIntent),
			...Object.keys(s2.byIntent),
		]);
		const sorted = [...allIntents].sort();

		console.log("\nPer-intent exact match rate comparison:");
		console.log(`${"Intent".padEnd(35)} V1%     V2%     Δ`);
		console.log("-".repeat(60));

		for (const intent of sorted) {
			const i1 = s1.byIntent[intent];
			const i2 = s2.byIntent[intent];
			const r1 = i1?.exactMatchRate ?? 0;
			const r2 = i2?.exactMatchRate ?? 0;
			const delta = r2 - r1;
			const sign = delta >= 0 ? "+" : "";
			console.log(
				`${intent.padEnd(35)} ${r1.toFixed(1).padStart(5)}   ${r2.toFixed(1).padStart(5)}   ${sign}${delta.toFixed(1)}`,
			);
		}
	}

	// Find examples where V2 improved over V1
	if (v1.results && v2.results) {
		const v1Map = new Map(v1.results.map((r) => [r.query, r]));
		const improved: Array<{ query: string; expected: string; v1pred: string | null; v2pred: string | null }> = [];
		const regressed: typeof improved = [];

		for (const r2 of v2.results) {
			const r1 = v1Map.get(r2.query);
			if (!r1) continue;
			if (!r1.exactMatch && r2.exactMatch) {
				improved.push({
					query: r2.query,
					expected: r2.expectedCommand,
					v1pred: r1.predictedCommand,
					v2pred: r2.predictedCommand,
				});
			} else if (r1.exactMatch && !r2.exactMatch) {
				regressed.push({
					query: r2.query,
					expected: r2.expectedCommand,
					v1pred: r1.predictedCommand,
					v2pred: r2.predictedCommand,
				});
			}
		}

		if (improved.length > 0) {
			console.log(`\nV2 improved (${improved.length} queries). Samples:`);
			for (const ex of improved.slice(0, 5)) {
				console.log(`  Q: ${ex.query.slice(0, 60)}`);
				console.log(`    expected: ${ex.expected}`);
				console.log(`    V1:       ${ex.v1pred?.slice(0, 60) ?? "(error)"}`);
				console.log(`    V2:       ${ex.v2pred?.slice(0, 60) ?? "(error)"}`);
			}
		}

		if (regressed.length > 0) {
			console.log(`\nV2 regressed (${regressed.length} queries). Samples:`);
			for (const ex of regressed.slice(0, 5)) {
				console.log(`  Q: ${ex.query.slice(0, 60)}`);
				console.log(`    expected: ${ex.expected}`);
				console.log(`    V1:       ${ex.v1pred?.slice(0, 60) ?? "(error)"}`);
				console.log(`    V2:       ${ex.v2pred?.slice(0, 60) ?? "(error)"}`);
			}
		}
	}
}

main();
