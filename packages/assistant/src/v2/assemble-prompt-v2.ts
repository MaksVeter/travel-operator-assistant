import type { ScoredChunk } from "core";
import type { IntentPrediction } from "./types.ts";
import type { SessionTurn } from "./session.ts";
import { buildSessionRoutingHint } from "./session-heuristics.ts";

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
- Catalog entries are ordered by relevance — [1] is the best match
- For initial flight availability (search/find/check flights between cities on a date): prefer the catalog entry whose signature is "1" when origin, destination, and date are present
- Use location and equipment identifiers exactly as the user provided them (airport codes, city names, airline codes, equipment names) — do not substitute city names for airport codes or vice versa
- Match the parameter style in the catalog Example (e.g. DDMMM date format, 3-letter codes where the Example uses codes)
- Encode commands (signatures starting with W/-CC, W/-AP, W/-AL, W/EQ-) produce codes from names; decode commands (W/*, W/EQ*) look up names from codes — pick encode vs decode based on what the user asked for
- For equipment encode (W/EQ-): use the full equipment name from the catalog Example when the Example shows a full name
- For military base or facility lookup: include state/region suffix when the user provides it (e.g. ",NC")
- Distance between airports (W/-AT): use W/-AT followed by each 3-letter airport code with AT prefix, separated by ≠ (e.g. W/-ATJFK≠ATCDG)
- Similar name list (W/-CY): list ambiguous city names when the user names a city without state/country
- Select from similar names (W/-SL): when the user picks a line/option number, output W/-SLN — a prior list display is not required
- Verify flight info from CPA (VA*): when verifying/checking segment details from availability without a line number, use line 1 (VA*1) per the catalog Example
- Redisplay last availability (1*R): when the user asks to bring back the previous availability search
- When SESSION CONTEXT shows a prior initial availability command (e.g. 110MARJFKLHR), follow-up requests are MODIFIERS — output 1*, 1‡, 1-, 1*CITY, or 1R… commands, NOT a new initial 1DATE search
- Return availability modifiers use 1R signatures (1R6P, 1R‡3, 1RMAR, etc.) — pick the catalog entry matching the requested change (time, days, date, month)
- When a catalog entry matches and required values are in the user message, output the command — prefer A over REFUSE`;

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
			const rank =
				i === 0
					? "best match"
					: i === 1
						? "second match"
						: i === 2
							? "third match"
							: `rank ${i + 1}`;
			const lines = [
				`[${i + 1} — ${rank}] ${c.description}`,
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
	let sessionRoutingHint = "";
	if (sessionHistory?.length) {
		const historyLines = sessionHistory
			.slice(-3)
			.map((t) => `  "${t.query}" → ${t.command}`)
			.join("\n");
		sessionBlock = `\nSESSION CONTEXT (previous commands in this session):\n${historyLines}\n`;
		sessionRoutingHint = buildSessionRoutingHint(sessionHistory);
		if (sessionRoutingHint) {
			sessionRoutingHint = `\n${sessionRoutingHint}\n`;
		}
	}

	const userMessage = `REFERENCE CATALOG (ordered by relevance — [1] is most likely):

${contextBlocks || "(no matching commands found — use REFUSE)"}
${intentHint}
${sessionBlock}${sessionRoutingHint}
---
USER REQUEST: ${originalQuery}

If SESSION CONTEXT shows a prior availability search, treat this as a modifier follow-up — use 1*, 1‡, 1-, 1*CITY, or 1R… from the catalog, not a new initial search. If the user is searching for flights between cities on a date (no prior session), use signature "1". For implicit phrasing, still output the matching catalog command when [1] is a clear match — do not REFUSE merely because the wording is indirect.`;

	return {
		system: SYSTEM_PROMPT,
		user: userMessage,
	};
}
