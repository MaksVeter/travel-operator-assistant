const MONTHS =
	"JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC";

/** Initial search: 1 + DDMMM + ORIGIN(3) + DEST(3) */
const INITIAL_AVAILABILITY_RE = new RegExp(
	`^1(\\d{1,2})(${MONTHS})([A-Z]{3})([A-Z]{3})$`,
	"i",
);

/** Same with optional departure time suffix (e.g. 11A, 6P). */
const INITIAL_AVAILABILITY_TIME_RE = new RegExp(
	`^1(\\d{1,2})(${MONTHS})([A-Z]{3})([A-Z]{3})(\\d{1,2}[AP])$`,
	"i",
);

/** LLM sometimes outputs 1* before a date instead of initial availability signature 1. */
const ERRONEOUS_STAR_BEFORE_DATE_RE = new RegExp(
	`^1\\*(\\d{1,2})(${MONTHS})`,
	"i",
);

export type NormalizeContext = {
	query: string;
	hasSession: boolean;
};

export type NormalizeSabreResult = {
	command: string;
	normalized: boolean;
	issues: string[];
};

export function looksLikeInitialAvailabilityQuery(query: string): boolean {
	const q = query.toLowerCase();
	return (
		/\b(flight|availability|search|find|check|city pair)\b/.test(q) &&
		(/\b(from|to|between)\b/.test(q) ||
			/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i.test(query) ||
			/\b\d{1,2}\b/.test(query) ||
			/\b[A-Z]{3}\b/.test(query))
	);
}

export function isWellFormedInitialAvailability(command: string): boolean {
	const compact = command.replace(/\s+/g, "");
	return (
		INITIAL_AVAILABILITY_RE.test(compact) ||
		INITIAL_AVAILABILITY_TIME_RE.test(compact)
	);
}

/** Fix 1110MAR… → 110MAR… only when the result is valid and the original was not. */
function tryFixDoubleLeadingOne(compact: string): string | null {
	if (!compact.startsWith("11")) return null;

	const candidate = `1${compact.slice(2)}`;
	if (
		isWellFormedInitialAvailability(candidate) &&
		!isWellFormedInitialAvailability(compact)
	) {
		return candidate;
	}
	return null;
}

/** Fix 1*05MAR… → 105MAR… — 1* is a modifier sig, not valid before a date. */
function tryFixErroneousStarBeforeDate(compact: string): string | null {
	if (!ERRONEOUS_STAR_BEFORE_DATE_RE.test(compact)) return null;

	const candidate = `1${compact.slice(2)}`;
	if (isWellFormedInitialAvailability(candidate)) {
		return candidate;
	}
	return null;
}

export function normalizeSabreCommand(
	command: string,
	context?: NormalizeContext,
): NormalizeSabreResult {
	const issues: string[] = [];
	let text = command.trim();
	let normalized = false;

	if (/\s/.test(text) && /^1[\d‡\-*R]/i.test(text)) {
		const compact = text.replace(/\s+/g, "");
		if (compact !== text) {
			text = compact;
			normalized = true;
			issues.push("removed_spaces");
		}
	}

	let compact = text.replace(/\s+/g, "");

	const starFix = tryFixErroneousStarBeforeDate(compact);
	if (starFix) {
		text = starFix;
		compact = starFix;
		normalized = true;
		issues.push("fixed_erroneous_star_before_date");
	}

	const doubleOneFix = tryFixDoubleLeadingOne(compact);
	if (doubleOneFix) {
		text = doubleOneFix;
		compact = doubleOneFix;
		normalized = true;
		issues.push("fixed_double_leading_one");
	}

	const cityPair = text.match(/^(1\*)([A-Z]+)$/i);
	if (cityPair && cityPair[2]!.length !== 6) {
		issues.push("city_pair_not_six_letters");
	}

	if (/^1R/i.test(text) && text.includes(":")) {
		text = text.replace(/:/g, "");
		normalized = true;
		issues.push("removed_time_colons");
	}

	if (context && !context.hasSession && looksLikeInitialAvailabilityQuery(context.query)) {
		const check = text.replace(/\s+/g, "");
		if (/^1\*/.test(check)) {
			issues.push("modifier_without_session_for_initial_search");
		} else if (!/^1R/i.test(check) && !isWellFormedInitialAvailability(check)) {
			issues.push("malformed_initial_availability");
		}
	}

	return { command: text, normalized, issues };
}

export function shouldRetryReturnTime(command: string, query: string): boolean {
	if (!/^1R/i.test(command)) return false;
	if (command.includes(":")) return true;
	if (/\d{1,2}:\d{2}/.test(query) && /^1R\d{1,2}[AP]$/i.test(command)) {
		return true;
	}
	return false;
}

export function shouldRetryCommand(
	command: string,
	query: string,
	hasSession: boolean,
	issues: string[],
): boolean {
	if (issues.includes("modifier_without_session_for_initial_search")) return true;
	if (issues.includes("malformed_initial_availability")) return true;
	if (issues.includes("city_pair_not_six_letters")) return true;
	if (shouldRetryReturnTime(command, query)) return true;

	if (!hasSession && looksLikeInitialAvailabilityQuery(query)) {
		const compact = command.replace(/\s+/g, "");
		if (/^1\*/.test(compact)) return true;
		if (
			!/^1R/i.test(compact) &&
			!/^1[‡\-]/.test(compact) &&
			!isWellFormedInitialAvailability(compact)
		) {
			return true;
		}
	}
	return false;
}

export function buildRetryHint(issues: string[], query: string): string {
	if (issues.includes("modifier_without_session_for_initial_search")) {
		return (
			"The user is starting a NEW flight availability search (not a modifier). " +
			'Output initial availability with signature "1": 1 + DDMMM + 3-letter origin + 3-letter destination as ONE continuous string with NO spaces. ' +
			"Use standard IATA airport codes for cities or airports mentioned. Do NOT use 1*."
		);
	}
	if (issues.includes("malformed_initial_availability")) {
		return (
			"Output initial availability: 1 + DDMMM + origin(3 letters) + destination(3 letters) as one continuous string, no spaces. " +
			"Use full 3-letter IATA codes. Match the catalog Example format exactly."
		);
	}
	if (issues.includes("city_pair_not_six_letters")) {
		return (
			"City pair modifier must be 1* followed by exactly six letters: three-letter origin then three-letter destination, no spaces."
		);
	}
	if (issues.includes("removed_time_colons") || shouldRetryReturnTime("", query)) {
		return (
			"Return time: concatenate hours, minutes, and AM/PM without colons. Include full date+time per catalog Example when both are requested."
		);
	}
	return "Fix the command format to match the catalog Example exactly.";
}
