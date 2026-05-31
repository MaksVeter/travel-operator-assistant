#!/usr/bin/env bun
/**
 * Split `validation-dataset.json` into reference (single-turn) and multi_turn files.
 *
 * Usage:
 *   bun run split:validation-dataset
 *   bun run scripts/split-validation-dataset.ts --in data/validation-dataset.json
 */

import fs from "node:fs";
import path from "node:path";

type DatasetRow = {
	id: string;
	type: string;
	[key: string]: unknown;
};

export type SplitValidationDatasetResult = {
	reference: DatasetRow[];
	multiTurn: DatasetRow[];
	referencePath: string;
	multiTurnPath: string;
};

export function splitValidationDataset(rows: DatasetRow[]): {
	reference: DatasetRow[];
	multiTurn: DatasetRow[];
} {
	const reference = rows.filter((row) => row.type !== "multi_turn");
	const multiTurn = rows.filter((row) => row.type === "multi_turn");
	return { reference, multiTurn };
}

export function writeSplitValidationDatasets(
	inputPath: string,
	options?: {
		referenceOut?: string;
		multiTurnOut?: string;
	},
): SplitValidationDatasetResult {
	const rootDir = path.resolve(path.dirname(inputPath), "..");
	const dataDir = path.join(rootDir, "data");
	const referencePath =
		options?.referenceOut ??
		path.join(dataDir, "validation-dataset-reference.json");
	const multiTurnPath =
		options?.multiTurnOut ??
		path.join(dataDir, "validation-dataset-multi-turn.json");

	const raw = fs.readFileSync(inputPath, "utf8");
	const rows = JSON.parse(raw) as DatasetRow[];
	if (!Array.isArray(rows)) {
		throw new Error("Dataset must be a JSON array");
	}

	const { reference, multiTurn } = splitValidationDataset(rows);

	fs.mkdirSync(path.dirname(referencePath), { recursive: true });
	fs.mkdirSync(path.dirname(multiTurnPath), { recursive: true });
	fs.writeFileSync(referencePath, `${JSON.stringify(reference, null, 2)}\n`, "utf8");
	fs.writeFileSync(multiTurnPath, `${JSON.stringify(multiTurn, null, 2)}\n`, "utf8");

	return { reference, multiTurn, referencePath, multiTurnPath };
}

function parseArgs(argv: string[]) {
	const cwd = process.cwd();
	let input = path.join(cwd, "data", "validation-dataset.json");
	let referenceOut: string | undefined;
	let multiTurnOut: string | undefined;

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--in" && argv[i + 1]) input = path.resolve(argv[++i]!);
		else if (arg === "--reference-out" && argv[i + 1]) {
			referenceOut = path.resolve(argv[++i]!);
		} else if (arg === "--multi-turn-out" && argv[i + 1]) {
			multiTurnOut = path.resolve(argv[++i]!);
		}
	}

	return { input, referenceOut, multiTurnOut };
}

function main() {
	const { input, referenceOut, multiTurnOut } = parseArgs(process.argv.slice(2));
	if (!fs.existsSync(input)) {
		throw new Error(`Input not found: ${input}`);
	}

	const { reference, multiTurn, referencePath, multiTurnPath } =
		writeSplitValidationDatasets(input, { referenceOut, multiTurnOut });

	console.log(`Source: ${input}`);
	console.log(`Reference (single-turn): ${reference.length} -> ${referencePath}`);
	console.log(`Multi-turn:              ${multiTurn.length} -> ${multiTurnPath}`);
}

if (import.meta.main) {
	main();
}
