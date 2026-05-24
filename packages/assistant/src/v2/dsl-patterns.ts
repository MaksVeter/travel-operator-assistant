/**
 * DSL pattern definitions for Sabre command validation.
 * Each pattern validates the structural shape of a generated command.
 */

export type DslPattern = {
	signature: string;
	regex: RegExp;
	intents: string[];
};

export const DSL_PATTERNS: DslPattern[] = [
	// Encoding commands
	{
		signature: "W/-CC",
		regex: /^W\/-CC[A-Z ]+$/,
		intents: ["encode_city"],
	},
	{
		signature: "W/-AP",
		regex: /^W\/-AP[A-Z ]+$/,
		intents: ["encode_airport"],
	},
	{
		signature: "W/-AL",
		regex: /^W\/-AL[A-Z ]+$/,
		intents: ["encode_airline"],
	},
	{
		signature: "W/EQ-",
		regex: /^W\/EQ-[A-Z0-9 ]+$/,
		intents: ["encode_aircraft_type"],
	},

	// Decoding commands
	{
		signature: "W/EQ*",
		regex: /^W\/EQ\*[A-Z0-9]{2,4}$/,
		intents: ["decode_aircraft_type"],
	},
	{
		signature: "W/*",
		regex: /^W\/\*[A-Z]{2,3}$/,
		intents: ["decode_city_airport", "decode_airline"],
	},

	// Airport/city lookup commands
	{
		signature: "W/-CY",
		regex: /^W\/-CY[A-Z ]+/,
		intents: [
			"find_closest_airports_state",
			"find_closest_airports_country",
			"display_similar_name_list",
		],
	},
	{
		signature: "W/-AT",
		regex: /^W\/-AT[A-Z]{3}/,
		intents: ["find_closest_airports_airport", "distance_between_airports"],
	},
	{
		signature: "W/-MB",
		regex: /^W\/-MB[A-Z ]+/,
		intents: ["find_closest_airports_military"],
	},
	{
		signature: "W/-SL",
		regex: /^W\/-SL\*?(\d+)?$/,
		intents: ["select_similar_name_list", "redisplay_similar_name_list"],
	},

	// Flight availability
	{
		signature: "1",
		regex: /^1\d{1,2}[A-Z]{3}[A-Z]{3}[A-Z]{3}/,
		intents: ["request_flight_availability"],
	},

	// Availability modifications
	{
		signature: "1*R",
		regex: /^1\*R$/,
		intents: ["redisplay_last_availability"],
	},
	{
		signature: "1*OA",
		regex: /^1\*OA$/,
		intents: ["redisplay_original_availability"],
	},
	{
		signature: "1*C",
		regex: /^1\*C$/,
		intents: ["display_additional_classes"],
	},
	{
		signature: "1*A",
		regex: /^1\*A[A-Z]{3}$/,
		intents: ["change_arrival_city"],
	},
	{
		signature: "1*D",
		regex: /^1\*D[A-Z]{3}$/,
		intents: ["change_departure_city"],
	},
	{
		signature: "1*",
		regex: /^1\*[A-Z]{3}[A-Z]{3}$/,
		intents: ["change_city_pair"],
	},
	{
		signature: "1*",
		regex: /^1\*\d{1,4}[AP]?$/,
		intents: ["change_departure_time"],
	},
	{
		signature: "1*",
		regex: /^1\*$/,
		intents: ["request_additional_availability"],
	},

	// Add/subtract days
	{
		signature: "1\u2021",
		regex: /^1‡\d+$/,
		intents: ["add_days_to_availability"],
	},
	{
		signature: "1-",
		regex: /^1-\d+$/,
		intents: ["subtract_days_from_availability"],
	},

	// Return availability
	{
		signature: "1R\u2021*",
		regex: /^1R‡\d+\*\d{1,4}[AP]?$/,
		intents: ["request_return_availability_add_days_time"],
	},
	{
		signature: "1R-*",
		regex: /^1R-\d+\*\d{1,4}[AP]?$/,
		intents: ["request_return_availability_sub_days_time"],
	},
	{
		signature: "1R\u2021",
		regex: /^1R‡\d+$/,
		intents: ["request_return_availability_add_days"],
	},
	{
		signature: "1R-",
		regex: /^1R-\d+$/,
		intents: ["request_return_availability_sub_days"],
	},
	{
		signature: "1R",
		regex: /^1R\d{1,2}[A-Z]{3}\d{1,4}[AP]?$/,
		intents: ["request_return_availability_date_time"],
	},
	{
		signature: "1R",
		regex: /^1R\d{1,2}[A-Z]{3}$/,
		intents: ["request_return_availability_date", "request_return_availability_month"],
	},
	{
		signature: "1R",
		regex: /^1R\d{1,4}[AP]?$/,
		intents: ["request_return_availability_time"],
	},

	// Verify flight info
	{
		signature: "VA*",
		regex: /^VA\*[\d\/]+$/,
		intents: [
			"verify_flight_info_from_cpa",
			"verify_flight_info_range",
			"verify_flight_info_specific",
		],
	},
];

/**
 * Validate a command against known DSL patterns.
 * Returns true if the command matches at least one pattern.
 */
export function matchesDslPattern(command: string): boolean {
	return DSL_PATTERNS.some((p) => p.regex.test(command));
}

/**
 * Find patterns that match a given intent.
 */
export function patternsForIntent(intent: string): DslPattern[] {
	return DSL_PATTERNS.filter((p) => p.intents.includes(intent));
}

/**
 * Validate that a command matches the expected pattern for a given intent.
 */
export function validateCommandForIntent(
	command: string,
	intent: string,
): boolean {
	const patterns = patternsForIntent(intent);
	if (patterns.length === 0) return true; // no pattern to validate against
	return patterns.some((p) => p.regex.test(command));
}
