import type { ScoredChunk } from "core";
import type { IntentPrediction } from "./types.ts";
import type { SessionTurn } from "./session.ts";

const SYSTEM_PROMPT = `You are a Sabre GDS command generator. You translate English natural language requests into exact Sabre cryptic commands.

OUTPUT FORMAT — pick exactly ONE:

A) A single valid Sabre command on one line. No quotes, no backticks, no markdown, no explanation, no commentary. Just the raw command string.

B) If the request is unclear, invalid, off-topic, or missing required parameters that cannot be inferred: respond with exactly "REFUSE" (nothing else).

RULES:
- Output ONLY the command string (option A) or ONLY the word REFUSE (option B)
- Commands are case-sensitive and positional — copy the exact syntax pattern from the reference
- Use the values from the user's request as arguments to the command (names, codes, dates, numbers — whatever the user provides goes into the command)
- Never invent parameters that the user did not mention
- Never output templates with placeholders like (city name) or {date}
- Never output multiple commands
- Never explain the command
- When in doubt, prefer generating a command if a matching reference exists`;

export type AssembledPrompt = {
	system: string;
	user: string;
};

export function assemblePromptV2(
	chunks: ScoredChunk[],
	originalQuery: string,
	predictedIntents: IntentPrediction[] | null,
	sessionHistory?: SessionTurn[],
): AssembledPrompt {
	const contextBlocks = chunks
		.map((hit, i) => {
			const c = hit.source;
			const lines = [
				`[${i + 1}] ${c.description}`,
				`  Signature: ${c.dsl_signature}`,
				`  Format: ${c.format}`,
				`  Example: ${c.example}`,
			];

			if (c.synonyms?.length) {
				lines.push(`  Also known as: ${c.synonyms.slice(0, 4).join(", ")}`);
			}

			// Add few-shot examples from user_queries if available
			if (c.user_queries?.length) {
				const samples = c.user_queries.slice(0, 2);
				lines.push(`  Sample queries: ${samples.join(" | ")}`);
			}

			return lines.join("\n");
		})
		.join("\n\n");

	// Build DSL constraint hint from intent prediction
	let intentHint = "";
	if (predictedIntents?.length && predictedIntents[0]!.confidence >= 0.7) {
		const top = predictedIntents[0]!;
		if (top.dsl_signature) {
			intentHint = `\nHINT: The most likely command starts with "${top.dsl_signature}". Verify against the reference catalog above.`;
		}
	}

	let sessionBlock = "";
	if (sessionHistory?.length) {
		const historyLines = sessionHistory
			.slice(-3)
			.map((t) => `  "${t.query}" → ${t.command}`)
			.join("\n");
		sessionBlock = `\nSESSION CONTEXT (previous commands in this session):\n${historyLines}\n`;
	}

	const userMessage = `REFERENCE CATALOG:

${contextBlocks || "(no matching commands found — use REFUSE)"}
${intentHint}
${sessionBlock}
---
USER REQUEST: ${originalQuery}`;

	return {
		system: SYSTEM_PROMPT,
		user: userMessage,
	};
}
