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

const RELEVANCE_LABELS = [
	"best match — highest relevance",
	"second match — lower relevance",
	"third match — lowest relevance",
] as const;

function relevanceLabel(rank: number, total: number): string {
	if (rank < RELEVANCE_LABELS.length) {
		return RELEVANCE_LABELS[rank]!;
	}
	return `rank ${rank + 1} of ${total} — lowest relevance`;
}

export function assemblePrompt(
	chunks: ScoredChunk[],
	userQuery: string,
): string {
	const commandBlocks = chunks
		.map((hit, i) => {
			const c = hit.source;
			const lines = [
				`[Command ${i + 1} — ${relevanceLabel(i, chunks.length)}]`,
				`  Description: ${c.description}`,
				`  Reference — a finished Sabre line (never return a template; copy the pattern using concrete values from the user): ${c.example}`,
				`  DSL family: ${c.dsl_signature}`,
			];

			if (c.synonyms?.length) {
				lines.push(`  Also known as: ${c.synonyms.slice(0, 4).join(", ")}`);
			}

			if (c.user_queries?.length) {
				const samples = c.user_queries.slice(0, 2);
				lines.push(`  Example user requests: ${samples.join(" | ")}`);
			}

			return lines.join("\n");
		})
		.join("\n\n");

	const examplesBulleted = REFUSAL_EXAMPLE_QUERIES.map((q) => `- ${q}`).join(
		"\n",
	);

	return `You are a travel industry terminal operator. The user writes only in English. Each message is standalone: assume no prior conversation and no remembered context.

Convert their English into exact Sabre GDS commands when possible.

TWO POSSIBLE OUTPUTS (pick exactly one):

A) VALID SABRE COMMAND — one line only: the command. No quotes, markdown, or explanation. The line must be a complete Sabre entry (no placeholders, no parentheses templates like W/-CC(city name)).

B) CANNOT BUILD COMMAND — use ONLY when the request is off-topic, no catalog entry applies, or a required value (city, airport, date, code, etc.) is missing and cannot be taken from the user message. Do NOT use B for how-to phrasing such as "how do I get/find/encode the code for X" when a catalog entry matches and X is named. Reply in English only, briefly:
1) First line exactly: I cannot build a Sabre command from your request.
2) Blank line, then this heading line: Examples of how to phrase a request:
3) Then copy the bullet list from EXAMPLE_QUERIES below verbatim (same wording, same order).

Rules for output A:
1. Return ONLY the command string
2. Follow the same shape as the Reference lines in the catalog (full concrete command, not a pattern with unfilled parts)
3. Use values spelled out in the current user message only
4. No extra text
5. Prefer [Command 1] when it matches the user's goal; consider lower-ranked entries only if [Command 1] clearly does not fit

EXAMPLE_QUERIES (use these bullets only when outputting B):
${examplesBulleted}

MATCHING COMMANDS (catalog, ordered by retrieval score — best match first):

${commandBlocks || "(none retrieved — use B if unsure)"}

Catalog priority: [Command 1] is the most likely match, [Command 2] less likely, [Command 3] least likely. Prefer the highest-ranked entry that fits; ignore lower-ranked entries that do not match the user's request.

---
User (English, single turn): "${userQuery}"

This is a request to generate a Sabre command, not a request for instructions or help text.
If a catalog entry matches and the user named the entity or value, respond with output A only.
Your response:`;
}
