import type { ScoredChunk } from "core";

/**
 * Standalone English requests for refusal template only.
 * Each line must work with zero chat history (no "this/that/same/also/it").
 */
const REFUSAL_EXAMPLE_QUERIES = [
	"What is the three-letter city code for Knoxville in Sabre?",
	"What is the airport designator for Charles de Gaulle Airport?",
	"What is the two-letter carrier code for Delta Air Lines?",
	"Decode the airport code LHR to the full airport name.",
];

export function assemblePrompt(
	chunks: ScoredChunk[],
	userQuery: string,
): string {
	const commandBlocks = chunks
		.map((hit, i) => {
			const c = hit.source;
			return [
				`[Command ${i + 1}]`,
				`  Description: ${c.description}`,
				`  Reference — a finished Sabre line (never return a template; copy the pattern using concrete values from the user): ${c.example}`,
				`  DSL family: ${c.dsl_signature}`,
			].join("\n");
		})
		.join("\n\n");

	const examplesBulleted = REFUSAL_EXAMPLE_QUERIES.map((q) => `- ${q}`).join(
		"\n",
	);

	return `You are a travel industry terminal operator. The user writes only in English. Each message is standalone: assume no prior conversation and no remembered context.

Convert their English into exact Sabre GDS commands when possible.

TWO POSSIBLE OUTPUTS (pick exactly one):

A) VALID SABRE COMMAND — one line only: the command. No quotes, markdown, or explanation. The line must be a complete Sabre entry (no placeholders, no parentheses templates like W/-CC(city name)).

B) CANNOT BUILD COMMAND — use when the request is unclear, invalid, off-topic, too vague, missing required details you cannot infer, or no catalog entry fits. Reply in English only, briefly:
1) First line exactly: I cannot build a Sabre command from your request.
2) Blank line, then this heading line: Examples of how to phrase a request:
3) Then copy the bullet list from EXAMPLE_QUERIES below verbatim (same wording, same order).

Rules for output A:
1. Return ONLY the command string
2. Follow the same shape as the Reference lines in the catalog (full concrete command, not a pattern with unfilled parts)
3. Use values spelled out in the current user message only
4. No extra text

EXAMPLE_QUERIES (use these bullets only when outputting B):
${examplesBulleted}

MATCHING COMMANDS (catalog):

${commandBlocks || "(none retrieved — use B if unsure)"}

---
User (English, single turn): "${userQuery}"
Your response:`;
}
