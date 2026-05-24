import type { LlmService } from "core";
import type { SessionTurn } from "./session.ts";

const REWRITE_SYSTEM_PROMPT = `You are a query preprocessor for a Sabre GDS command lookup system.

Your task: rewrite the user's natural language input into a clean, concise search query optimized for semantic search against a Sabre command knowledge base.

Rules:
- Remove conversational noise (greetings, apologies, filler words, context about callers/clients)
- Preserve ALL concrete parameters: city names, airport names/codes, airline names/codes, dates, flight numbers, passenger counts, cabin classes, connection points
- Output a single short English phrase focused on the travel action and its parameters
- Do NOT generate a Sabre command
- Do NOT add information not present in the original query or session history
- Do NOT explain or add commentary
- Output ONLY the rewritten query text, nothing else`;

const REWRITE_WITH_CONTEXT_SYSTEM_PROMPT = `You are a query preprocessor for a Sabre GDS command lookup system.

Your task: rewrite the user's natural language input into a clean, concise search query optimized for semantic search against a Sabre command knowledge base. Use the session history to resolve references and ambiguity.

Rules:
- Remove conversational noise (greetings, apologies, filler words, context about callers/clients)
- Resolve pronouns and references using session history ("same city", "change it to", "actually make it", "add more days")
- Preserve ALL concrete parameters: city names, airport names/codes, airline names/codes, dates, flight numbers, passenger counts, cabin classes, connection points
- Output a single short English phrase focused on the travel action and its parameters
- Do NOT generate a Sabre command
- Do NOT explain or add commentary
- Output ONLY the rewritten query text, nothing else`;

export async function rewriteQuery(
	llm: LlmService,
	rawQuery: string,
	sessionHistory?: SessionTurn[],
): Promise<string> {
	let systemPrompt: string;
	let userMessage: string;

	if (sessionHistory?.length) {
		systemPrompt = REWRITE_WITH_CONTEXT_SYSTEM_PROMPT;
		const historyBlock = sessionHistory
			.slice(-3)
			.map((t) => `User: "${t.query}" → ${t.command}`)
			.join("\n");
		userMessage = `SESSION HISTORY:\n${historyBlock}\n\nCURRENT QUERY: ${rawQuery}`;
	} else {
		systemPrompt = REWRITE_SYSTEM_PROMPT;
		userMessage = rawQuery;
	}

	const rewritten = await llm.completeWithSystem(
		systemPrompt,
		userMessage,
		{ maxTokens: 128, temperature: 0 },
	);

	if (!rewritten || rewritten.length < 3) {
		return rawQuery;
	}

	return rewritten;
}
