/**
 * Host screen text after SabreCommandLLSRQ — split into:
 * - **Technical**: syntax / schema / host hard reject (INVALID_*, FORMAT/INVLD, bare FORMAT, ERR,).
 * - **Semantic**: lookup / context / business messages (CANNOT BE FOUND, NO PRIOR CPA, …).
 * Not classified: host busy (`RETRY LATER` / `ALL HOST LINE ACTIVE`) — transient capacity, not command validity.
 * Empty-only displays (headers + END OF DISPLAY) are not flagged.
 */

function normalizeScreen(screen: string): string {
	return screen
		.replace(/[\u0087\u2021]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

type Rule = { id: string; match: (upper: string) => boolean };

/** Host rejects syntax / action / format / ERR — technical invalidity. */
const TECHNICAL_REJECT_RULES: Rule[] = [
	{
		id: "INVLD_CHAR_OR_FORMAT",
		match: (u) =>
			u.includes("INVLD CHAR") ||
			(u.includes("FORMAT") && u.includes("INVLD")) ||
			(u.includes("FORMAT") && u.includes("INVALID") && u.includes("NAME")),
	},
	{ id: "INVALID_HOST", match: (u) => u.includes("INVALID HOST") },
	{ id: "INVALID_ACTION", match: (u) => u.includes("INVALID ACTION") },
	{ id: "INVALID_FORMAT", match: (u) => u.includes("INVALID FORMAT") },
	{
		id: "ERR_PREFIX",
		match: (u) => u.includes("ERR,") || u.startsWith("ERR "),
	},
	{
		id: "FORMAT_BARE",
		match: (u) => {
			if (!u.includes("FORMAT")) return false;
			if (u.includes("INVLD")) return false;
			if (u.length > 36) return false;
			if (
				u.includes("WHEN MULTIPLE") ||
				u.includes("NEAREST AIR") ||
				u.includes("POSSIBLE CHOICES") ||
				u.includes("END OF DISPLAY")
			) {
				return false;
			}
			return true;
		},
	},
];

/** Lookup / context / limits — semantic invalidity (technical pipeline still OK). */
const SEMANTIC_REJECT_RULES: Rule[] = [
	{ id: "CANNOT_BE_FOUND", match: (u) => u.includes("CANNOT BE FOUND") },
	{ id: "NOT_ALLOWED", match: (u) => u.includes("NOT ALLOWED") },
	{ id: "ENTRY_NO_LONGER_VALID", match: (u) => u.includes("ENTRY NO LONGER VALID") },
	{ id: "INVALID_TICKET_STOCK", match: (u) => u.includes("INVALID TICKET STOCK") },
	{ id: "NO_PSGR_DATA", match: (u) => u.includes("NO PSGR DATA") },
	{ id: "NO_PRIOR_CPA", match: (u) => u.includes("NO PRIOR CPA") },
	{ id: "CK_ACTION", match: (u) => u.includes("CK ACTION") || u.includes("CK ACTION/STATUS") },
	{
		id: "EXACT_MATCH_NOT_FOUND",
		match: (u) => u.includes("EXACT MATCH NOT FOUND"),
	},
	{
		id: "NO_SIMILAR_NAME_LIST",
		match: (u) => u.includes("NO CURRENT SIMILAR NAME LIST"),
	},
	{
		id: "NOT_ENT",
		match: (u) =>
			u.includes("NOT ENT BGNG") || u.includes(".NOT ENT."),
	},
	{ id: "NEED_DUTY_CODE", match: (u) => u.includes("NEED DUTY CODE") },
	{ id: "NO_HIST", match: (u) => /\bNO HIST\b/.test(u) },
];

function firstMatch(upper: string, rules: Rule[]): string | null {
	for (const r of rules) {
		if (r.match(upper)) return r.id;
	}
	return null;
}

/** Technical host-screen rejection (INVALID_*, FORMAT/INVLD, ERR, bare FORMAT). */
export function describeHostScreenTechnicalRejection(
	screen: string | undefined | null,
): string | null {
	if (screen == null) return null;
	const raw = String(screen);
	if (!raw.trim()) return null;
	const upper = normalizeScreen(raw).toUpperCase();
	return firstMatch(upper, TECHNICAL_REJECT_RULES);
}

/** Semantic host-screen rejection (lookup / context / limits); excludes technical rules. */
export function describeHostScreenSemanticRejection(
	screen: string | undefined | null,
): string | null {
	if (screen == null) return null;
	const raw = String(screen);
	if (!raw.trim()) return null;
	const upper = normalizeScreen(raw).toUpperCase();
	// Technical issues are not duplicated as semantic.
	if (firstMatch(upper, TECHNICAL_REJECT_RULES)) return null;
	return firstMatch(upper, SEMANTIC_REJECT_RULES);
}

export function isHostScreenTechnicalOk(screen: string | undefined | null): boolean {
	return describeHostScreenTechnicalRejection(screen) === null;
}

/** True when no **semantic** rules match (does not evaluate technical rules). */
export function isHostScreenSemanticallyOk(screen: string | undefined | null): boolean {
	return describeHostScreenSemanticRejection(screen) === null;
}
