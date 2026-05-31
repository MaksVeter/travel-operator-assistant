import type { DslChunk, ScoredChunk, SearchClient } from "core";
import {
	isDecodeCityAirportQuery,
	isDistanceBetweenAirportsQuery,
	isEncodeAircraftTypeQuery,
	isEncodeAirportQuery,
	isEncodeCityQuery,
	isFindClosestAirportsAirportQuery,
	isFindClosestAirportsCountryQuery,
	isFindClosestAirportsMilitaryQuery,
	isInitialFlightAvailabilityQuery,
	isRedisplayLastAvailabilityQuery,
	isSelectSimilarNameListQuery,
	isSimilarNameListQuery,
	isVerifyFlightInfoQuery,
	isVerifyFlightInfoRangeQuery,
} from "./query-heuristics.ts";
import type { SessionTurn } from "./session.ts";
import {
	hasModifierSessionContext,
	isAddDaysToAvailabilityQuery,
	isChangeArrivalCityQuery,
	isChangeCityPairQuery,
	isChangeDepartureCityQuery,
	isChangeDepartureTimeQuery,
	isRequestReturnAvailabilityAddDaysQuery,
	isRequestReturnAvailabilityAddDaysTimeQuery,
	isRequestReturnAvailabilityDateQuery,
	isRequestReturnAvailabilityDateTimeQuery,
	isRequestReturnAvailabilityMonthQuery,
	isRequestReturnAvailabilitySubDaysQuery,
	isRequestReturnAvailabilitySubDaysTimeQuery,
	isRequestReturnAvailabilityTimeQuery,
	isSubtractDaysFromAvailabilityQuery,
	shouldSkipInitialAvailabilityAugment,
} from "./session-heuristics.ts";

type AugmentRule = {
	intent: string;
	matches: (query: string, history?: SessionTurn[]) => boolean;
};

/**
 * When hybrid search misses the right catalog entry, fetch it by intent name
 * from OpenSearch (term query on `intent` field). Does not modify the index.
 */
const AUGMENT_RULES: AugmentRule[] = [
	{
		intent: "request_flight_availability",
		matches: (query, history) =>
			isInitialFlightAvailabilityQuery(query) &&
			!shouldSkipInitialAvailabilityAugment(query, history),
	},
	{
		intent: "display_similar_name_list",
		matches: (query) => isSimilarNameListQuery(query),
	},
	{
		intent: "select_similar_name_list",
		matches: (query) => isSelectSimilarNameListQuery(query),
	},
	{
		intent: "verify_flight_info_from_cpa",
		matches: (query) => isVerifyFlightInfoQuery(query),
	},
	{
		intent: "verify_flight_info_range",
		matches: (query) => isVerifyFlightInfoRangeQuery(query),
	},
	{
		intent: "find_closest_airports_country",
		matches: (query) => isFindClosestAirportsCountryQuery(query),
	},
	{
		intent: "find_closest_airports_airport",
		matches: (query) => isFindClosestAirportsAirportQuery(query),
	},
	{
		intent: "distance_between_airports",
		matches: (query) => isDistanceBetweenAirportsQuery(query),
	},
	{
		intent: "redisplay_last_availability",
		matches: (query) => isRedisplayLastAvailabilityQuery(query),
	},
	{
		intent: "change_departure_time",
		matches: (query, history) =>
			hasModifierSessionContext(query, history) &&
			isChangeDepartureTimeQuery(query),
	},
	{
		intent: "add_days_to_availability",
		matches: (query, history) =>
			hasModifierSessionContext(query, history) &&
			isAddDaysToAvailabilityQuery(query),
	},
	{
		intent: "subtract_days_from_availability",
		matches: (query, history) =>
			hasModifierSessionContext(query, history) &&
			isSubtractDaysFromAvailabilityQuery(query),
	},
	{
		intent: "change_arrival_city",
		matches: (query, history) =>
			hasModifierSessionContext(query, history) &&
			isChangeArrivalCityQuery(query),
	},
	{
		intent: "change_departure_city",
		matches: (query, history) =>
			hasModifierSessionContext(query, history) &&
			isChangeDepartureCityQuery(query),
	},
	{
		intent: "change_city_pair",
		matches: (query, history) =>
			hasModifierSessionContext(query, history) &&
			isChangeCityPairQuery(query),
	},
	{
		intent: "request_return_availability_time",
		matches: (query, history) =>
			hasModifierSessionContext(query, history) &&
			isRequestReturnAvailabilityTimeQuery(query),
	},
	{
		intent: "request_return_availability_add_days",
		matches: (query, history) =>
			hasModifierSessionContext(query, history) &&
			isRequestReturnAvailabilityAddDaysQuery(query),
	},
	{
		intent: "request_return_availability_sub_days",
		matches: (query, history) =>
			hasModifierSessionContext(query, history) &&
			isRequestReturnAvailabilitySubDaysQuery(query),
	},
	{
		intent: "request_return_availability_add_days_time",
		matches: (query, history) =>
			hasModifierSessionContext(query, history) &&
			isRequestReturnAvailabilityAddDaysTimeQuery(query),
	},
	{
		intent: "request_return_availability_sub_days_time",
		matches: (query, history) =>
			hasModifierSessionContext(query, history) &&
			isRequestReturnAvailabilitySubDaysTimeQuery(query),
	},
	{
		intent: "request_return_availability_date",
		matches: (query, history) =>
			hasModifierSessionContext(query, history) &&
			isRequestReturnAvailabilityDateQuery(query),
	},
	{
		intent: "request_return_availability_month",
		matches: (query, history) =>
			hasModifierSessionContext(query, history) &&
			isRequestReturnAvailabilityMonthQuery(query),
	},
	{
		intent: "request_return_availability_date_time",
		matches: (query, history) =>
			hasModifierSessionContext(query, history) &&
			isRequestReturnAvailabilityDateTimeQuery(query),
	},
	{
		intent: "encode_city",
		matches: (query) => isEncodeCityQuery(query),
	},
	{
		intent: "encode_airport",
		matches: (query) => isEncodeAirportQuery(query),
	},
	{
		intent: "decode_city_airport",
		matches: (query) => isDecodeCityAirportQuery(query),
	},
	{
		intent: "encode_aircraft_type",
		matches: (query) => isEncodeAircraftTypeQuery(query),
	},
	{
		intent: "find_closest_airports_military",
		matches: (query) => isFindClosestAirportsMilitaryQuery(query),
	},
];

export async function augmentRetrieval(
	chunks: ScoredChunk[],
	query: string,
	search: SearchClient,
	indexName: string,
	sessionHistory?: SessionTurn[],
): Promise<ScoredChunk[]> {
	let result = chunks;

	for (const rule of AUGMENT_RULES) {
		if (!rule.matches(query, sessionHistory)) continue;
		if (result.some((c) => c.source.intent === rule.intent)) continue;

		const hit = await search.intentSearch<DslChunk>(indexName, rule.intent);
		if (!hit) continue;

		const topScore = result[0]?.score ?? hit.score;
		result = [{ score: topScore, source: hit.source }, ...result];
	}

	return result;
}
