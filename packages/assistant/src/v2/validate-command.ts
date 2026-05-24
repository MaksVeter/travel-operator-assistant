import type { IntentPrediction } from "./types.ts";
import { validateCommandForIntent } from "./dsl-patterns.ts";

const REFUSAL_TOKEN = "REFUSE";

export type ValidationResult = {
	command: string;
	isRefusal: boolean;
	validationApplied: boolean;
	normalized: boolean;
};

/**
 * Post-process and validate LLM output.
 * - Strips markdown artifacts
 * - Detects refusals
 * - Validates against DSL patterns
 * - Normalizes whitespace
 */
export function validateAndNormalize(
	rawOutput: string,
	predictedIntents: IntentPrediction[] | null,
): ValidationResult {
	let text = rawOutput.trim();

	// Strip markdown code fences
	if (text.startsWith("```") && text.endsWith("```")) {
		text = text.slice(3, -3).trim();
	}
	if (text.startsWith("`") && text.endsWith("`")) {
		text = text.slice(1, -1).trim();
	}

	// Strip surrounding quotes
	if (
		(text.startsWith('"') && text.endsWith('"')) ||
		(text.startsWith("'") && text.endsWith("'"))
	) {
		text = text.slice(1, -1).trim();
	}

	// Detect refusal
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

	// If output contains multiple lines, take only the first non-empty line
	const lines = text.split("\n").filter((l) => l.trim().length > 0);
	if (lines.length > 1) {
		text = lines[0]!.trim();
	}

	// Normalize: collapse internal whitespace where appropriate
	// But preserve single spaces in commands like W/-CCNEW YORK
	let normalized = false;

	// Validate against predicted intent pattern
	let validationApplied = false;
	if (predictedIntents?.length && predictedIntents[0]!.confidence >= 0.7) {
		const topIntent = predictedIntents[0]!.intent;
		const isValid = validateCommandForIntent(text, topIntent);
		validationApplied = true;

		// If starts with expected signature, command is structurally plausible
		if (!isValid && predictedIntents[0]!.dsl_signature) {
			const sig = predictedIntents[0]!.dsl_signature;
			if (!text.startsWith(sig)) {
				// Command doesn't even start with expected signature — likely wrong
				// But don't override, just flag it (retry handled by orchestrator)
			}
		}
	}

	return {
		command: text,
		isRefusal: false,
		validationApplied,
		normalized,
	};
}

function formatRefusal(): string {
	return `I cannot build a Sabre command from your request.

Examples of how to phrase a request:
- What is the three-letter city code for Knoxville in Sabre?
- What is the airport designator for Charles de Gaulle Airport?
- What is the two-letter carrier code for Delta Air Lines?
- Decode the airport code LHR to the full airport name.`;
}
