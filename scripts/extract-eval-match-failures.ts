#!/usr/bin/env bun
/**
 * Extract eval results where signatureMatch or parameterMatch failed.
 *
 * Usage:
 *   bun run scripts/extract-eval-match-failures.ts
 *   bun run scripts/extract-eval-match-failures.ts --input data/assistant-eval-results.json --output data/assistant-eval-match-failures.json
 */

import fs from "node:fs";
import path from "node:path";

type EvalResult = {
	id: string;
	signatureMatch: boolean;
	parameterMatch: boolean;
	[key: string]: unknown;
};

type EvalFile = {
	generatedAt?: string;
	assistantApiUrl?: string;
	sourceDataset?: string;
	summary?: Record<string, unknown>;
	results: EvalResult[];
};

function parseArgs(argv: string[]) {
	const args = new Map<string, string>();
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg.startsWith("--")) {
			const key = arg.slice(2);
			const value = argv[i + 1];
			if (value && !value.startsWith("--")) {
				args.set(key, value);
				i++;
			}
		}
	}
	return args;
}

const rootDir = path.resolve(import.meta.dir, "..");
const args = parseArgs(process.argv.slice(2));

const inputPath = path.resolve(
	rootDir,
	args.get("input") ?? "data/assistant-eval-results.json",
);
const outputPath = path.resolve(
	rootDir,
	args.get("output") ?? "data/assistant-eval-match-failures.json",
);

const source = JSON.parse(fs.readFileSync(inputPath, "utf8")) as EvalFile;

const signatureFailures = source.results.filter((row) => !row.signatureMatch);
const parameterFailures = source.results.filter((row) => !row.parameterMatch);
const anyMatchFailures = source.results.filter(
	(row) => !row.signatureMatch || !row.parameterMatch,
);

const output = {
	extractedAt: new Date().toISOString(),
	sourceFile: path.relative(rootDir, inputPath),
	sourceGeneratedAt: source.generatedAt ?? null,
	sourceSummary: source.summary ?? null,
	counts: {
		totalResults: source.results.length,
		signatureMatchFailures: signatureFailures.length,
		parameterMatchFailures: parameterFailures.length,
		anyMatchFailures: anyMatchFailures.length,
	},
	failures: {
		signatureMatch: signatureFailures,
		parameterMatch: parameterFailures,
		anyMatch: anyMatchFailures,
	},
};

fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");

console.log(`Wrote ${outputPath}`);
console.log(`  total results: ${output.counts.totalResults}`);
console.log(`  signatureMatch failures: ${output.counts.signatureMatchFailures}`);
console.log(`  parameterMatch failures: ${output.counts.parameterMatchFailures}`);
console.log(`  any match failures: ${output.counts.anyMatchFailures}`);
