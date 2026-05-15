/**
 * Curated adversarial NL → gold Sabre-style command rows (see generate-validation-dataset.ts).
 * Gold `command` strings follow chunks.json (no symbols or formats absent there).
 * `1‡` / `1R‡` offsets: use full CPA `1…` or absolute `1RDDMMM` / `1RDDMMMTT` where bare `1‡` / `1R‡` fails over SOAP.
 */

export type ManualHardCaseRow = {
  query: string;
  intent: string;
  command: string;
  dsl_signature?: string;
  hard?: boolean;
};

export const MANUAL_HARD_CASES: ManualHardCaseRow[] = [
  {
    query:
      "Hi, sorry — client is on the phone and I’m half in another PNR. They *say* nonstop only and business if possible, codeshare ok, but honestly right now I just need plain CPA: outbound December 13 from Frankfurt to Dublin, morning-ish if you can — ignore everything else I said about class and stops.",
    intent: "request_flight_availability",
    command: "113DECFRADUB11A",
    dsl_signature: "1",
    hard: true,
  },
  {
    query:
      "Don’t change the return yet. Forget rail. Forget hotels. On the CPA screen: same search but push the local departure time to afternoon, like 2pm-ish, partner keeps flip-flopping.",
    intent: "change_departure_time",
    command: "1*2P",
    dsl_signature: "1*",
    hard: true,
  },
  {
    query:
      "We’re not rebooking — just more options on what’s already up. Scroll the availability, next page, thanks.",
    intent: "request_additional_availability",
    command: "1*",
    dsl_signature: "1*",
    hard: true,
  },
  {
    query:
      "I fat-fingered the last modify. Bring back the *previous* availability matrix exactly as it was before I touched time/cities.",
    intent: "redisplay_last_availability",
    command: "1*R",
    dsl_signature: "1*R",
    hard: true,
  },
  {
    query:
      "Strip my tweaks — not the original PNR, I mean the original *CPA* before I started tweaking departure times on the availability screen. Full reset of that display.",
    intent: "redisplay_original_availability",
    command: "1*OA",
    dsl_signature: "1*OA",
    hard: true,
  },
  {
    query:
      "They want to see hidden buckets / extra booking classes on this availability — not repricing, just expand the class display on the current CPA.",
    intent: "display_additional_classes",
    command: "1*C",
    dsl_signature: "1*C",
    hard: true,
  },
  {
    query:
      "Inbound stayed same; for the return leg same calendar day but later bank — think evening bank, passenger hates dawn connections (ignore that preference, just the time shift).",
    intent: "request_return_availability_time",
    command: "1R6P",
    dsl_signature: "1R",
    hard: true,
  },
  {
    query:
      "Return a week after outbound — I know there’s weekend vs weekday noise in the fare rules, but for the *availability pull* just step the return forward by seven days.",
    intent: "request_return_availability_add_days",
    command: "1R20NOV",
    dsl_signature: "1R‡",
    hard: true,
  },
  {
    query:
      "Actually they need to fly back *earlier* than what we quoted — shave five days off the return side relative to the outbound date we’re holding.",
    intent: "request_return_availability_sub_days",
    command: "1R-5",
    dsl_signature: "1R-",
    hard: true,
  },
  {
    query:
      "Combo move on the return: jump forward fifteen days *and* pin departure to late morning (filters in the fare are a mess — ignore alliances, just the raw return shift).",
    intent: "request_return_availability_add_days_time",
    command: "1R05JAN10A",
    dsl_signature: "1R‡*",
    hard: true,
  },
  {
    query:
      "Backtrack the return: five days earlier than current return context, and lock the time to mid-afternoon — passenger mentioned ‘no red-eyes’ but that’s not Sabre syntax here.",
    intent: "request_return_availability_sub_days_time",
    command: "1R-5*2P",
    dsl_signature: "1R-*",
    hard: true,
  },
  {
    query:
      "Same month, not next month — return on the 22nd only (I don’t care about the outbound line number right now).",
    intent: "request_return_availability_date",
    command: "1R22",
    dsl_signature: "1R",
    hard: true,
  },
  {
    query:
      "Cross-month return: Nov 22, don’t infer from ‘next Sunday’ — explicit calendar, ignore the verbal fluff about Thanksgiving traffic.",
    intent: "request_return_availability_month",
    command: "1R22NOV",
    dsl_signature: "1R",
    hard: true,
  },
  {
    query:
      "Exact return stamp: November 22, morning departure band — not ‘morning’, not ‘around ten’, the precise calendar + time-of-day intent for the return leg.",
    intent: "request_return_availability_date_time",
    command: "1R22NOV10A",
    dsl_signature: "1R",
    hard: true,
  },
  {
    query:
      "Availability is up — before I sell, sanity-check segment 1 equipment/stops from the CPA line (agent thinks it’s a misconnect, probably wrong).",
    intent: "verify_flight_info_from_cpa",
    command: "VA*1",
    dsl_signature: "VA*",
    hard: true,
  },
  {
    query:
      "Batch-verify legs 1 through 3 — stops, aircraft, elapsed time — I’m not pricing, just validating what the screen claims for that contiguous block.",
    intent: "verify_flight_info_range",
    command: "VA*1-3",
    dsl_signature: "VA*",
    hard: true,
  },
  {
    query:
      "Lines 1 and 4 only — not 2-3, not ‘all’ — disjoint segments, policy wants both checked before we hold.",
    intent: "verify_flight_info_specific",
    command: "VA*1/4",
    dsl_signature: "VA*",
    hard: true,
  },
  {
    query:
      "Not FRA airport, not metro code — **city** encode for ‘Munich’ the way you’d type in the city-encode field in Sabre (customer spelled it Munchen in email, ignore).",
    intent: "encode_city",
    command: "W/-CCMUNICH",
    dsl_signature: "W/-CC",
    hard: true,
  },
  {
    query:
      "Airport side — full name garbage in email says ‘De Gaulle’ / ‘Roissy’ mess; I need the airport-name encode for the main Paris CDG field.",
    intent: "encode_airport",
    command: "W/-APCHARLES DE GAULLE",
    dsl_signature: "W/-AP",
    hard: true,
  },
  {
    query:
      "Carrier string is messy (‘LH group’, ‘Lufthansa German Airlines’) — I just need the canonical airline encode token, not Star Alliance noise.",
    intent: "encode_airline",
    command: "W/-ALLUFTHANSA",
    dsl_signature: "W/-AL",
    hard: true,
  },
  {
    query:
      "Equipment side: passenger said ‘320neo family’ — map that mess to the generic narrowbody equipment encode Sabre expects (don’t book, just encode).",
    intent: "encode_aircraft_type",
    command: "W/EQ-AIRBUS A320",
    dsl_signature: "W/EQ-",
    hard: true,
  },
  {
    query:
      "Three-letter soup from an OTA: ‘What even is OGG as a *city/airport* decode?’ — not airline, not hotel.",
    intent: "decode_city_airport",
    command: "W/*OGG",
    dsl_signature: "W/*",
    hard: true,
  },
  {
    query:
      "GDS pasted ‘BA’ in remarks — decode the *airline* meaning, not baggage allowance, not British national rail.",
    intent: "decode_airline",
    command: "W/*BA",
    dsl_signature: "W/*",
    hard: true,
  },
  {
    query:
      "Equipment column says 77W — I need the plain equipment decode from the code, ignore cabin config and Wi‑Fi marketing text.",
    intent: "decode_aircraft_type",
    command: "W/EQ*77W",
    dsl_signature: "W/EQ*",
    hard: true,
  },
  {
    query:
      "Mileage tool — not great-circle from Google, not driving — Sabre airport-to-airport distance between LAX and LHR using the mileage-between-airports entry.",
    intent: "distance_between_airports",
    command: "W/-ATLAX≠ATLHR",
    dsl_signature: "W/-AT≠AT",
    hard: true,
  },
  {
    query:
      "Alternate airport search from *another airport* — what’s close to HKG for reroute options (policy babble about ‘ferry acceptable’ is irrelevant).",
    intent: "find_closest_airports_airport",
    command: "W/-ATHKG",
    dsl_signature: "W/-AT",
    hard: true,
  },
  {
    query:
      "US city+state disambiguation: closest ten to Columbus, OH — not Columbus, GA; not CMH-only literalism, use the closest-airports entry with city and state spelled out.",
    intent: "find_closest_airports_state",
    command: "W/-CYCOLUMBUS, OH",
    dsl_signature: "W/-CY",
    hard: true,
  },
  {
    query:
      "International closest-airports: Vancouver but country CA — don’t assume US zip, ignore ‘Pacific time’ chatter.",
    intent: "find_closest_airports_country",
    command: "W/-CYVANCOUVER, CA",
    dsl_signature: "W/-CY",
    hard: true,
  },
  {
    query:
      "Military base leg — passenger is TDY; need closest commercial fields to Fort Hood, TX (don’t route via private strip fantasy).",
    intent: "find_closest_airports_military",
    command: "W/-MBFORT HOOD,TX",
    dsl_signature: "W/-MB",
    hard: true,
  },
  {
    query:
      "Ambiguous metro: ‘Springfield’ with zero state — list similar names first, I’ll pick after (don’t guess Illinois vs Missouri).",
    intent: "display_similar_name_list",
    command: "W/-CYSPRINGFIELD",
    dsl_signature: "W/-CY",
    hard: true,
  },
  {
    query:
      "From the Springfield disambiguation list — take line 2, not 1, not 3; agent confirmed on Slack.",
    intent: "select_similar_name_list",
    command: "W/-SL2",
    dsl_signature: "W/-SL",
    hard: true,
  },
  {
    query:
      "I scrolled away — bring the ambiguous city list back, same as the last similar-name list, without re-querying from scratch.",
    intent: "redisplay_similar_name_list",
    command: "W/-SL*",
    dsl_signature: "W/-SL*",
    hard: true,
  },
  {
    query:
      "Same date family but nudge **outbound** +2 days — ignore return, ignore hotel, ignore seat maps; just shift CPA forward two.",
    intent: "add_days_to_availability",
    command: "115DECFRADUB11A",
    dsl_signature: "1‡",
    hard: true,
  },
  {
    query:
      "Back up the CPA calendar three days — client’s conference moved earlier; don’t touch city pair yet.",
    intent: "subtract_days_from_availability",
    command: "1-3",
    dsl_signature: "1-",
    hard: true,
  },
  {
    query:
      "Keep everything else; only swap **destination** to OGG — origin and date family stay per last screen (fare rules whining is noise).",
    intent: "change_arrival_city",
    command: "1*AOGG",
    dsl_signature: "1*A",
    hard: true,
  },
  {
    query:
      "Re-origin the search: depart from LHR now, arrival side unchanged — ignore ‘open jaw’ lecture from the lead.",
    intent: "change_departure_city",
    command: "1*DLHR",
    dsl_signature: "1*D",
    hard: true,
  },
  {
    query:
      "Hard reroute: new city pair JFK–LHR on the **same** day/time family as before — not a fresh date entry, just swap both endpoints.",
    intent: "change_city_pair",
    command: "1*JFKLHR",
    dsl_signature: "1*",
    hard: true,
  },
];
