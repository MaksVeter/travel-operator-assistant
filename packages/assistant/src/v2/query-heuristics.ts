/** Heuristic: initial flight availability search (signature `1`), not return/modifier commands. */
export function isInitialFlightAvailabilityQuery(query: string): boolean {
	const q = query.toLowerCase();

	const hasReturnModifier =
		/\breturn\b/.test(q) ||
		/\b(add|subtract|move|shift|change)\s+\d*\s*days?\b/.test(q) ||
		/\b(add|subtract)\s+\d+\s+days?\s+(to|from)\b/.test(q) ||
		/\badd\s+(one|\d+|a)\s+days?\b/.test(q) ||
		/\b(next|previous)\s+day\b/.test(q) ||
		/\bgo\s+back\s+\d*\s*days?\b/.test(q) ||
		/\bextend\s+by\s+\d+\s+days?\b/.test(q) ||
		/\bchange\s+(departure|arrival)\s+(city|time)\b/.test(q) ||
		/\bmodify\s+(the\s+)?return\b/.test(q) ||
		/\bdestination\s+to\b/.test(q) ||
		/\bdeparture\s+city\s+to\b/.test(q);

	if (hasReturnModifier) return false;

	const hasAvailabilityCue =
		/\bflight(s)?\s+availability\b/.test(q) ||
		/\bavailability\s+(check|search|request)?\b/.test(q) ||
		/\b(city\s+pair|route)\s+availability\b/.test(q) ||
		/\b(search|find|check|show|get)\s+(available\s+)?flights?\b/.test(q) ||
		/\bavailable\s+flights?\b/.test(q) ||
		/\bwhat\s+flights?\s+(are\s+)?available\b/.test(q) ||
		/\bflights?\s+(from|between|departing|to)\b/.test(q);

	const hasRouteOrDate =
		/\b(from|to|between|departing|arriving)\b/.test(q) ||
		/\b[A-Z]{3}\b/.test(query) ||
		/\b\d{1,2}\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i.test(q) ||
		/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s*\d{1,2}\b/i.test(q) ||
		/\b\d{1,2}[a-z]{3}\b/i.test(q);

	return hasAvailabilityCue && hasRouteOrDate;
}

/** List of cities with ambiguous names (e.g. Springfield). */
export function isSimilarNameListQuery(query: string): boolean {
	const q = query.toLowerCase();
	return (
		/\bsimilar\s+name\b/.test(q) ||
		/\b(all|which)\s+.*\s+cities\b/.test(q) ||
		/\bwithout knowing the state\b/.test(q) ||
		/\bwhich state\b/.test(q) ||
		/\bcity name match\b/.test(q) ||
		/\bshow all options\b/.test(q) ||
		/\ball options\b/.test(q) ||
		/(?:^|\s)[a-z]+(?:\s+-\s+|\s+)(?:which state|without)/i.test(query)
	);
}

export function isSelectSimilarNameListQuery(query: string): boolean {
	const q = query.toLowerCase();
	return (
		/\bline\s+\d+\b/.test(q) ||
		/\b(which|pick|select|choose|go with)\s+(one|option|line|the)\b/.test(q) ||
		/\b(first|second|third)\s+option\b/.test(q)
	);
}

export function isVerifyFlightInfoQuery(query: string): boolean {
	const q = query.toLowerCase();
	return (
		(/\b(cpa|availability)\b/.test(q) &&
			/\b(flight\s+info|segment|details|verify|check)\b/.test(q)) ||
		/\bverify\s+segment\s+info\b/.test(q) ||
		/\bcheck flight details from availability\b/.test(q) ||
		(/\b(verify|check)\b/.test(q) &&
			/\b(stops|equipment|segment)\b/.test(q) &&
			/\b(line|availability|cpa|display)\b/.test(q))
	);
}

export function isVerifyFlightInfoRangeQuery(query: string): boolean {
	const q = query.toLowerCase();
	return (
		/\bverify\b/.test(q) &&
		/\b(those|these|multiple|range|through|to)\b/.test(q) &&
		/\bflight(s)?\b/.test(q)
	);
}

export function isFindClosestAirportsCountryQuery(query: string): boolean {
	const q = query.toLowerCase();
	return (
		/\b(closest|nearest|nearby)\b/.test(q) &&
		/\b(airports?|apts?)\b/.test(q) &&
		(/\b(country|state)\b/.test(q) ||
			/,\s*[A-Z]{2}\b/.test(query) ||
			/\b[a-z]{3,}\s+(australia|canada|france|germany|japan|uk|united states)\b/.test(
				q,
			))
	);
}

export function isFindClosestAirportsAirportQuery(query: string): boolean {
	const q = query.toLowerCase();
	if (/\b(country|state|military|base)\b/.test(q)) return false;
	return (
		/\b(closest|nearest|nearby)\b/.test(q) &&
		/\b(airports?|apts?)\b/.test(q) &&
		(/\b(to|near|around)\b/.test(q) || /\b[A-Z]{3}\b/.test(query))
	);
}

export function isDistanceBetweenAirportsQuery(query: string): boolean {
	const q = query.toLowerCase();
	const hasDistanceCue =
		/\b(distance|mileage|miles|how far)\b/.test(q) ||
		/\bmileage calculation\b/.test(q);
	const iataCount = query.match(/\b[A-Z]{3}\b/g)?.length ?? 0;
	const hasTwoLocations =
		iataCount >= 2 ||
		(/\b(from|to|between)\b/.test(q) &&
			(/\bairports?\b/.test(q) || iataCount >= 1)) ||
		/\b[a-z]{3,}\s+(to|and)\s+[a-z]{3,}\b/.test(q);
	return hasDistanceCue && hasTwoLocations;
}

export function isRedisplayLastAvailabilityQuery(query: string): boolean {
	const q = query.toLowerCase();
	return (
		/\b(last|previous)\b/.test(q) &&
		/\b(flight\s+)?availability\b/.test(q) &&
		/\b(back|again|redisplay|show|get|pull)\b/.test(q)
	);
}

export function isEncodeCityQuery(query: string): boolean {
	const q = query.toLowerCase();
	if (/\bdecode\b/.test(q) || /\bwhat (city|airport|name)\b/.test(q)) return false;
	return (
		/\b(city code|encode city|sabre code for)\b/.test(q) ||
		/\b(3.?letter|three.?letter)\s+code\b/.test(q) ||
		/\bcode for (the )?(city|town)\b/.test(q)
	);
}

export function isEncodeAirportQuery(query: string): boolean {
	const q = query.toLowerCase();
	if (/\bdecode\b/.test(q) || /\bwhat (city|airport|name)\b/.test(q)) return false;
	return (
		/\b(airport code|encode airport)\b/.test(q) ||
		/\bcode for (the )?airport\b/.test(q) ||
		/\bw\/-ap\b/.test(q)
	);
}

export function isDecodeCityAirportQuery(query: string): boolean {
	const q = query.toLowerCase();
	if (/\b(airport code|city code|encode|get the code|code for)\b/.test(q)) return false;
	return (
		/\bdecode\b/.test(q) ||
		/\bwhat (city|airport|name) (is|for)\b/.test(q) ||
		(/\b[A-Z]{3}\b/.test(query) &&
			/\b(what|name|decode|lookup|pls|please)\b/.test(q))
	);
}

export function isEncodeAircraftTypeQuery(query: string): boolean {
	const q = query.toLowerCase();
	return (
		/\b(aircraft|plane|equipment|eq)\s+code\b/.test(q) ||
		/\bcode for (the )?(a320|a380|737|777|787|airbus|boeing)\b/.test(q) ||
		/\bencode (aircraft|equipment|plane)\b/.test(q)
	);
}

export function isFindClosestAirportsMilitaryQuery(query: string): boolean {
	const q = query.toLowerCase();
	return (
		/\b(closest|nearest|nearby)\b/.test(q) &&
		/\b(military|base|afb|air force)\b/.test(q)
	);
}
