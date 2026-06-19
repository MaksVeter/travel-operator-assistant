import type { IntentPrediction } from "./types.ts";
import { validateCommandForIntent } from "./dsl-patterns.ts";
import {
	type NormalizeContext,
	buildRetryHint,
	normalizeSabreCommand,
	shouldRetryCommand,
} from "./sabre-command-normalize.ts";

const REFUSAL_TOKEN = "REFUSE";

export type ValidationResult = {
	command: string;
	isRefusal: boolean;
	validationApplied: boolean;
	normalized: boolean;
	/** Set when a follow-up LLM retry is recommended. */
	retryHint?: string;
};

/**
 * Post-process and validate LLM output.
 */
export function validateAndNormalize(
	rawOutput: string,
	predictedIntents: IntentPrediction[] | null,
	context?: NormalizeContext,
): ValidationResult {
	let text = rawOutput.trim();

	if (text.startsWith("```") && text.endsWith("```")) {
		text = text.slice(3, -3).trim();
	}
	if (text.startsWith("`") && text.endsWith("`")) {
		text = text.slice(1, -1).trim();
	}

	if (
		(text.startsWith('"') && text.endsWith('"')) ||
		(text.startsWith("'") && text.endsWith("'"))
	) {
		text = text.slice(1, -1).trim();
	}

	if (
		text === REFUSAL_TOKEN ||
		text.toLowerCase().startsWith("i cannot") ||
		text.toLowerCase().startsWith("i can't") ||
		text.toLowerCase().startsWith("sorry") ||
		text.toLowerCase().startsWith("i'm unable")
	) {
		return {
			command: formatRefusal(),
			isRefusal: true,
			validationApplied: false,
			normalized: false,
		};
	}

	const lines = text.split("\n").filter((l) => l.trim().length > 0);
	if (lines.length > 1) {
		text = lines[0]!.trim();
	}

	text = sanitizeSabreHomoglyphs(text);

	const sabreNorm = normalizeSabreCommand(text, context);
	text = sabreNorm.command;
	let normalized = sabreNorm.normalized;

	let validationApplied = false;
	if (predictedIntents?.length && predictedIntents[0]!.confidence >= 0.7) {
		validateCommandForIntent(text, predictedIntents[0]!.intent);
		validationApplied = true;
	}

	let retryHint: string | undefined;
	if (
		context &&
		shouldRetryCommand(
			text,
			context.query,
			context.hasSession,
			sabreNorm.issues,
		)
	) {
		retryHint = buildRetryHint(sabreNorm.issues, context.query);
	}

	return {
		command: text,
		isRefusal: false,
		validationApplied,
		normalized,
		retryHint,
	};
}

function sanitizeSabreHomoglyphs(text: string): string {
	const map: Record<string, string> = {
		"\u0410": "A",
		"\u0412": "B",
		"\u0415": "E",
		"\u041A": "K",
		"\u041C": "M",
		"\u041D": "H",
		"\u041E": "O",
		"\u0420": "R",
		"\u0421": "C",
		"\u0422": "T",
		"\u0425": "X",
		"\u0391": "A",
		"\u0392": "B",
		"\u0395": "E",
		"\u039A": "K",
		"\u039C": "M",
		"\u039F": "O",
		"\u03A1": "R",
		"\u03A4": "T",
		"\u03A7": "X",
	};
	return [...text].map((ch) => map[ch] ?? ch).join("");
}

function formatRefusal(): string {
	return `I cannot build a Sabre command from your request.

Examples of how to phrase a request:
- What is the three-letter city code for a city in Sabre?
- What is the airport designator for an international airport?
- What is the two-letter carrier code for an airline?
- Decode an airport code to the full airport name.`;
}
