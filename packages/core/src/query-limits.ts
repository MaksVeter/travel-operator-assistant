/** Bedrock / typical LLM context uses ~4 Latin chars per token on average. */
const APPROX_CHARS_PER_TOKEN = 4;

export const DEFAULT_MAX_QUERY_TOKENS = 4000;

/**
 * Rough token estimate without a tokenizer (good enough to cap query size).
 */
export function estimateTokenCount(text: string): number {
	if (!text) return 0;
	return Math.ceil(text.length / APPROX_CHARS_PER_TOKEN);
}

export function truncateQueryToMaxTokens(
	text: string,
	maxTokens: number,
): { text: string; truncated: boolean } {
	if (estimateTokenCount(text) <= maxTokens) {
		return { text, truncated: false };
	}
	let maxChars = maxTokens * APPROX_CHARS_PER_TOKEN;
	if (maxChars <= 0) {
		return { text: "", truncated: text.length > 0 };
	}
	let cut = text.slice(0, maxChars);
	while (cut.length > 0) {
		const code = cut.charCodeAt(cut.length - 1);
		if (code >= 0xd800 && code <= 0xdbff) {
			cut = cut.slice(0, -1);
			continue;
		}
		break;
	}
	return { text: cut, truncated: true };
}
