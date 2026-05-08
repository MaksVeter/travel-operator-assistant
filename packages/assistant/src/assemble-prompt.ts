import type { ScoredChunk } from "core";

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
				`  Syntax: ${c.format}`,
				`  Example input: "${c.user_queries?.[0] ?? ""}" -> Example output: "${c.example}"`,
				`  DSL Signature: ${c.dsl_signature}`,
			].join("\n");
		})
		.join("\n\n");

	return `You are a travel industry terminal operator. Convert natural language into exact Sabre GDS commands.

STRICT RULES:
1. Return ONLY the command string, nothing else
2. Follow the format exactly as shown in examples
3. Replace placeholders with actual values from the user query
4. No explanations, no markdown, no quotes, no extra text

MATCHING COMMANDS:

${commandBlocks}

---
User says: "${userQuery}"
Command:`;
}
