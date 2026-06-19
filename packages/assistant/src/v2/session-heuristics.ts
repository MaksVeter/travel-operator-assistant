import type { SessionTurn } from "./session.ts";

export function getLastCommand(history?: SessionTurn[]): string | null {
	if (!history?.length) return null;
	return history[history.length - 1]!.command;
}

/** Initial availability search command (e.g. 110MARJFKLHR), not a modifier. */
export function isInitialAvailabilityCommand(command: string): boolean {
	return /^1\d{1,2}(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)/i.test(
		command,
	);
}

export function hasAvailabilitySession(history?: SessionTurn[]): boolean {
	const cmd = getLastCommand(history);
	return cmd !== null && isInitialAvailabilityCommand(cmd);
}

export function isReturnModifierQuery(query: string): boolean {
	return /\breturn\b/i.test(query);
}

export function isAvailabilityModifierQuery(query: string): boolean {
	const q = query.toLowerCase();
	if (isReturnModifierQuery(query)) return true;
	return (
		/\b(change|modify|adjust|update|switch|move|shift|extend|add|subtract|go back)\b/.test(
			q,
		) ||
		/\b(next|previous)\s+day\b/.test(q) ||
		(/\b\d+\s*(am|pm)\b/i.test(query) &&
			/\b(flights?|departure|time|instead|search|look)\b/.test(q)) ||
		(/\b(morning|evening|afternoon|noon)\b/.test(q) &&
			/\b(flights?|departure|time|search)\b/.test(q)) ||
		/\bdestination to\b/.test(q) ||
		/\bdeparture city to\b/.test(q) ||
		/\borigin to\b/.test(q)
	);
}

export function hasModifierSessionContext(
	query: string,
	history?: SessionTurn[],
): boolean {
	if (!history?.length) {
		return (
			isAvailabilityModifierQuery(query) && !isReturnModifierQuery(query)
		);
	}
	if (hasAvailabilitySession(history)) return true;
	if (isReturnModifierQuery(query)) return true;
	return isAvailabilityModifierQuery(query);
}

export function shouldSkipInitialAvailabilityAugment(
	query: string,
	history?: SessionTurn[],
): boolean {
	if (!history?.length) return false;
	if (!hasAvailabilitySession(history)) return false;
	return isAvailabilityModifierQuery(query) || isReturnModifierQuery(query);
}

export function buildSessionRoutingHint(history?: SessionTurn[]): string {
	const cmd = getLastCommand(history);
	if (!cmd) return "";

	if (/^1R/i.test(cmd)) {
		return 'SESSION HINT: Previous command was a return availability modifier. Follow-up commands likely start with "1R" (e.g. 1R‡, 1R-, 1R6P).';
	}
	if (isInitialAvailabilityCommand(cmd)) {
		return 'SESSION HINT: Previous command was an initial availability search. This follow-up is a MODIFIER — use 1*, 1‡, 1-, or 1*ORIGINDEST for outbound changes. Use 1R… signatures ONLY when the user explicitly mentions return flights. Do NOT output a new initial 1DATEORIGINDEST command.';
	}
	return "";
}

export function isChangeDepartureTimeQuery(query: string): boolean {
	const q = query.toLowerCase();
	if (isReturnModifierQuery(query)) return false;
	return (
		/\b(change|modify|adjust|search|look for|set)\b.*\b(time|departure time)\b/.test(
			q,
		) ||
		(/\b\d+\s*(am|pm)\b/i.test(query) &&
			/\b(flights?|departure|time|instead|slot|window)\b/.test(q)) ||
		(/\b(morning|evening|afternoon)\b/.test(q) &&
			/\b(flights?|departure|time|search|modify)\b/.test(q))
	);
}

export function isAddDaysToAvailabilityQuery(query: string): boolean {
	const q = query.toLowerCase();
	if (isReturnModifierQuery(query)) return false;
	return (
		/\b(add|extend|forward|move)\b.*\bdays?\b/.test(q) ||
		/\bnext day\b/.test(q) ||
		/\bdays?\s+(later|forward)\b/.test(q) ||
		/\blater\b.*\bdays?\b/.test(q) ||
		/\bextend by \d+ days?\b/.test(q)
	);
}

export function isSubtractDaysFromAvailabilityQuery(query: string): boolean {
	const q = query.toLowerCase();
	if (isReturnModifierQuery(query)) return false;
	return (
		/\b(subtract|go back|move back|back|earlier)\b.*\bdays?\b/.test(q) ||
		/\bprevious day\b/.test(q) ||
		/\b\d+\s+days?\s+(earlier|back)\b/.test(q)
	);
}

export function isChangeArrivalCityQuery(query: string): boolean {
	const q = query.toLowerCase();
	if (/\borigin\b/.test(q) && /\bdestination\b/.test(q)) return false;
	return (
		/\b(change|modify|switch|update)\b.*\b(destination|arrival)\b/.test(q) ||
		/\bdestination to\b/.test(q)
	);
}

export function isChangeDepartureCityQuery(query: string): boolean {
	const q = query.toLowerCase();
	if (/\borigin\b/.test(q) && /\bdestination\b/.test(q)) return false;
	return (
		/\b(change|modify|switch|update)\b.*\b(departure city|origin|departure)\b/.test(
			q,
		) || /\bdeparture city to\b/.test(q)
	);
}

export function isChangeCityPairQuery(query: string): boolean {
	const q = query.toLowerCase();
	return (
		(/\bdestination\b/.test(q) && /\borigin\b/.test(q)) ||
		/\bboth\b.*\b(cities|airports|origin|destination)\b/.test(q)
	);
}

export function isRequestReturnAvailabilityTimeQuery(query: string): boolean {
	const q = query.toLowerCase();
	return (
		/\breturn\b/.test(q) &&
		(/\b(\d+\s*(am|pm)|:\d{2}|time|hour|evening|morning|afternoon)\b/i.test(
			query,
		) ||
			/\bat \d/.test(q))
	);
}

export function isRequestReturnAvailabilityAddDaysQuery(query: string): boolean {
	const q = query.toLowerCase();
	return (
		/\breturn\b/.test(q) &&
		/\b(add|later|plus|extend|\d+\s*days?\s+later)\b/.test(q) &&
		!/\b(subtract|earlier|back|before)\b/.test(q) &&
		!/\b\d+\s*(am|pm)\b/i.test(query)
	);
}

export function isRequestReturnAvailabilitySubDaysQuery(query: string): boolean {
	const q = query.toLowerCase();
	return (
		/\breturn\b/.test(q) &&
		/\b(subtract|earlier|before|back|\d+\s*days?\s+earlier)\b/.test(q) &&
		!/\b(add|later|plus)\b/.test(q) &&
		!/\b\d+\s*(am|pm)\b/i.test(query)
	);
}

export function isRequestReturnAvailabilityAddDaysTimeQuery(
	query: string,
): boolean {
	const q = query.toLowerCase();
	return (
		/\breturn\b/.test(q) &&
		/\b(add|later|plus)\b/.test(q) &&
		/\bdays?\b/.test(q) &&
		(/\b\d+\s*(am|pm)\b/i.test(query) ||
			/\b(time|departure|at \d|morning|evening)\b/.test(q))
	);
}

export function isRequestReturnAvailabilitySubDaysTimeQuery(
	query: string,
): boolean {
	const q = query.toLowerCase();
	return (
		/\breturn\b/.test(q) &&
		/\b(subtract|earlier|before|back)\b/.test(q) &&
		/\bdays?\b/.test(q) &&
		(/\b\d+\s*(am|pm)\b/i.test(query) ||
			/\b(time|departure|at \d|morning|evening|afternoon)\b/.test(q))
	);
}

export function isRequestReturnAvailabilityDateQuery(query: string): boolean {
	const q = query.toLowerCase();
	if (!/\breturn\b/.test(q)) return false;
	if (/\b\d+\s*(am|pm)\b/i.test(query)) return false;
	return (
		/\b(for|on)\b.*\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\d{1,2})\b/i.test(
			query,
		) || /\breturn availability for\b/.test(q)
	);
}

export function isRequestReturnAvailabilityMonthQuery(query: string): boolean {
	const q = query.toLowerCase();
	return (
		/\breturn\b/.test(q) &&
		/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i.test(
			query,
		) &&
		!/\b\d+\s*(am|pm)\b/i.test(query)
	);
}

export function isRequestReturnAvailabilityDateTimeQuery(
	query: string,
): boolean {
	const q = query.toLowerCase();
	return (
		/\breturn\b/.test(q) &&
		/\b(on|for)\b.*\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\d{1,2})\b/i.test(
			query,
		) &&
		(/\b\d+\s*(am|pm)\b/i.test(query) ||
			/\b(at \d|morning|evening|afternoon|time)\b/.test(q))
	);
}
