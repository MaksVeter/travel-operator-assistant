#!/usr/bin/env bun
/**
 * Compare V1 and V2 assistant evaluation results side-by-side.
 * Includes new metrics: signature_match, parameter_match, success, intent_accuracy, refusal_rate.
 * Per-category breakdown: encoding / decoding / availability / multi_turn.
 *
 * Usage:
 *   bun run compare:v1-v2
 *   bun run scripts/compare-v1-v2.ts --v1 data/assistant-eval-results.json --v2 data/assistant-eval-results-v2-translate.json
 */

import fs from "node:fs";
import path from "node:path";

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

type EvalSummary = {
	evaluated?: number;
	signatureMatch?: number;
	signatureMatchRate?: number;
	parameterMatch?: number;
	parameterMatchRate?: number;
	exactMatch?: number;
	exactMatchRate?: number;
	success?: number;
	successRate?: number;
	intentCorrect?: number;
	intentTotal?: number;
	intentAccuracy?: number;
	refusals?: number;
	refusalRate?: number;
	apiErrors?: number;
	byCategory?: Record<string, CategoryStats>;
	byIntent?: Record<
		string,
		CategoryStats & { exactMatchRate?: number }
	>;
};

type EvalResult = {
	id?: string;
	query?: string;
	intent?: string;
	category?: string;
	expectedCommand?: string;
	predictedCommand?: string | null;
	signatureMatch?: boolean;
	parameterMatch?: boolean;
	exactMatch?: boolean;
	success?: boolean;
	refusal?: boolean;
};

type EvalReport = {
	generatedAt?: string;
	assistantApiUrl?: string;
	evaluatedRowCount?: number;
	summary?: EvalSummary;
	results?: EvalResult[];
};

function parseArgs(argv: string[]) {
	const cwd = process.cwd();
	let v1Path = path.join(cwd, "data", "assistant-eval-results.json");
	let v2Path = path.join(
		cwd,
		"data",
		"assistant-eval-results-v2-translate.json",
	);

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

function pct(n: number | undefined, total: number | undefined): number {
	if (!n || !total) return 0;
	return Math.round((1000 * n) / total) / 10;
}

function fmtVal(val: number | undefined, suffix = ""): string {
	if (val === undefined) return "     N/A";
	return `${String(val).padStart(8)}${suffix}`;
}

function fmtPct(val: number | undefined): string {
	if (val === undefined) return "     N/A";
	return `${val.toFixed(1).padStart(7)}%`;
}

function fmtDelta(v1: number | undefined, v2: number | undefined): string {
	if (v1 === undefined || v2 === undefined) return "   --";
	const d = v2 - v1;
	return `${d >= 0 ? "+" : ""}${d.toFixed(1)}`.padStart(6);
}

function main() {
	const { v1Path, v2Path } = parseArgs(process.argv);

	const v1 = loadReport(v1Path);
	const v2 = loadReport(v2Path);

	if (!v1 || !v2) {
		console.error("\nCannot compare -- one or both result files missing.");
		console.error("Run evaluations first:");
		console.error("  bun run evaluate:assistant");
		console.error("  bun run evaluate:v2");
		process.exit(1);
	}

	const s1 = v1.summary;
	const s2 = v2.summary;

	// ── Overall metrics table ──

	console.log(
		"\n========================================================================",
	);
	console.log(
		"                     V1 vs V2 Evaluation Comparison                      ",
	);
	console.log(
		"========================================================================",
	);
	console.log(
		`  ${"Metric".padEnd(24)} ${"V1".padStart(10)} ${"V2".padStart(10)} ${"Delta".padStart(8)}`,
	);
	console.log(`  ${"-".repeat(54)}`);

	const metrics: Array<{
		label: string;
		v1: number | undefined;
		v2: number | undefined;
		isPct?: boolean;
	}> = [
		{ label: "Evaluated", v1: s1?.evaluated, v2: s2?.evaluated },
		{
			label: "Signature Match %",
			v1: s1?.signatureMatchRate,
			v2: s2?.signatureMatchRate,
			isPct: true,
		},
		{
			label: "Parameter Match %",
			v1: s1?.parameterMatchRate,
			v2: s2?.parameterMatchRate,
			isPct: true,
		},
		{
			label: "Success %",
			v1: s1?.successRate,
			v2: s2?.successRate,
			isPct: true,
		},
		{
			label: "Exact Match %",
			v1: s1?.exactMatchRate,
			v2: s2?.exactMatchRate,
			isPct: true,
		},
		{
			label: "Intent Accuracy %",
			v1: undefined,
			v2: s2?.intentAccuracy,
			isPct: true,
		},
		{
			label: "Refusal Rate %",
			v1: s1?.refusalRate,
			v2: s2?.refusalRate,
			isPct: true,
		},
		{ label: "API Errors", v1: s1?.apiErrors, v2: s2?.apiErrors },
	];

	for (const m of metrics) {
		const v1s = m.isPct ? fmtPct(m.v1) : fmtVal(m.v1);
		const v2s = m.isPct ? fmtPct(m.v2) : fmtVal(m.v2);
		const delta = fmtDelta(m.v1, m.v2);
		console.log(`  ${m.label.padEnd(24)} ${v1s.padStart(10)} ${v2s.padStart(10)} ${delta.padStart(8)}`);
	}

	// ── Per-category breakdown ──

	const cat1 = s1?.byCategory;
	const cat2 = s2?.byCategory;
	if (cat1 || cat2) {
		const allCategories = new Set([
			...Object.keys(cat1 ?? {}),
			...Object.keys(cat2 ?? {}),
		]);
		const sorted = [...allCategories].sort();

		console.log(
			"\n------------------------------------------------------------------------",
		);
		console.log("  Per-category success rate:");
		console.log(
			`  ${"Category".padEnd(16)} ${"V1 sig%".padStart(9)} ${"V2 sig%".padStart(9)} ${"V1 succ%".padStart(10)} ${"V2 succ%".padStart(10)} ${"Delta".padStart(8)}`,
		);
		console.log(`  ${"-".repeat(64)}`);

		for (const cat of sorted) {
			const c1 = cat1?.[cat];
			const c2 = cat2?.[cat];

			const v1Sig = c1 ? pct(c1.signatureMatch, c1.total) : undefined;
			const v2Sig = c2 ? pct(c2.signatureMatch, c2.total) : undefined;
			const v1Succ = c1 ? pct(c1.success, c1.total) : undefined;
			const v2Succ = c2 ? pct(c2.success, c2.total) : undefined;

			console.log(
				`  ${cat.padEnd(16)} ${fmtPct(v1Sig).padStart(9)} ${fmtPct(v2Sig).padStart(9)} ${fmtPct(v1Succ).padStart(10)} ${fmtPct(v2Succ).padStart(10)} ${fmtDelta(v1Succ, v2Succ).padStart(8)}`,
			);
		}
	}

	// ── Per-intent breakdown ──

	const int1 = s1?.byIntent;
	const int2 = s2?.byIntent;
	if (int1 || int2) {
		const allIntents = new Set([
			...Object.keys(int1 ?? {}),
			...Object.keys(int2 ?? {}),
		]);
		const sorted = [...allIntents].sort();

		console.log(
			"\n------------------------------------------------------------------------",
		);
		console.log("  Per-intent success rate:");
		console.log(
			`  ${"Intent".padEnd(40)} ${"V1%".padStart(7)} ${"V2%".padStart(7)} ${"Delta".padStart(7)}`,
		);
		console.log(`  ${"-".repeat(63)}`);

		for (const intent of sorted) {
			const i1 = int1?.[intent];
			const i2 = int2?.[intent];
			const r1 = i1 ? pct(i1.success, i1.total) : undefined;
			const r2 = i2 ? pct(i2.success, i2.total) : undefined;
			console.log(
				`  ${intent.padEnd(40)} ${fmtPct(r1).padStart(7)} ${fmtPct(r2).padStart(7)} ${fmtDelta(r1, r2).padStart(7)}`,
			);
		}
	}

	// ── Improved / regressed examples ──

	if (v1.results && v2.results) {
		const v1Map = new Map<string, EvalResult>();
		for (const r of v1.results) {
			const key = r.id ?? r.query ?? "";
			if (key) v1Map.set(key, r);
		}

		type Example = {
			key: string;
			intent: string;
			expected: string;
			v1pred: string | null;
			v2pred: string | null;
		};
		const improved: Example[] = [];
		const regressed: Example[] = [];

		for (const r2 of v2.results) {
			const key = r2.id ?? r2.query ?? "";
			if (!key) continue;
			const r1 = v1Map.get(key);
			if (!r1) continue;

			const r1ok = r1.success ?? r1.exactMatch ?? false;
			const r2ok = r2.success ?? r2.exactMatch ?? false;

			if (!r1ok && r2ok) {
				improved.push({
					key,
					intent: r2.intent ?? "",
					expected: r2.expectedCommand ?? "",
					v1pred: r1.predictedCommand ?? null,
					v2pred: r2.predictedCommand ?? null,
				});
			} else if (r1ok && !r2ok) {
				regressed.push({
					key,
					intent: r2.intent ?? "",
					expected: r2.expectedCommand ?? "",
					v1pred: r1.predictedCommand ?? null,
					v2pred: r2.predictedCommand ?? null,
				});
			}
		}

		if (improved.length > 0) {
			console.log(
				`\nV2 improved (${improved.length} cases). Samples:`,
			);
			for (const ex of improved.slice(0, 5)) {
				console.log(`  ${ex.key.slice(0, 60)} [${ex.intent}]`);
				console.log(`    expected: ${ex.expected}`);
				console.log(
					`    V1:       ${ex.v1pred?.slice(0, 60) ?? "(error)"}`,
				);
				console.log(
					`    V2:       ${ex.v2pred?.slice(0, 60) ?? "(error)"}`,
				);
			}
		}

		if (regressed.length > 0) {
			console.log(
				`\nV2 regressed (${regressed.length} cases). Samples:`,
			);
			for (const ex of regressed.slice(0, 5)) {
				console.log(`  ${ex.key.slice(0, 60)} [${ex.intent}]`);
				console.log(`    expected: ${ex.expected}`);
				console.log(
					`    V1:       ${ex.v1pred?.slice(0, 60) ?? "(error)"}`,
				);
				console.log(
					`    V2:       ${ex.v2pred?.slice(0, 60) ?? "(error)"}`,
				);
			}
		}

		if (improved.length === 0 && regressed.length === 0) {
			console.log(
				"\nNo improvements or regressions detected (all matched results are identical).",
			);
		}
	}

	console.log(
		"\n========================================================================\n",
	);
}

main();
