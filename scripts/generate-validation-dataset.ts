#!/usr/bin/env bun
/**
 * Validation dataset: natural-language query → Sabre-style command for intents in chunks.json.
 * Lists are expanded beyond the prototype in data-generator.ts (major hubs, carriers, airport names).
 *
 * Usage (from travel-operator-assistant):
 *   bun run generate:validation-dataset
 *   bun run scripts/generate-validation-dataset.ts --chunks ../../chunks.json --out ./data/validation-dataset.json --rounds 40 --hard 120
 *   --hard 0  → only curated manual hard cases, no random noisy wrappers
 * Curated adversarial rows: scripts/manual-hard-cases.ts
 */

import fs from "node:fs";
import path from "node:path";
import { MANUAL_HARD_CASES } from "./manual-hard-cases.ts";

/** Mileage-between-airports separator per chunks.json (`W/-AT≠AT`, example `W/-ATLAX≠ATLHR`). */
const CHUNK_DISTANCE_SEP = "\u2260";

const SABRE_MONTHS = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
] as const;

/** CPA date DDMMM shifted by whole days (calendar); year fixed for stable validation. */
function addDaysToSabreDate(sabreDate: string, deltaDays: number): string {
  const m = sabreDate.match(/^(\d{1,2})([A-Z]{3})$/i);
  if (!m) return sabreDate;
  const day = Number.parseInt(m[1]!, 10);
  const mon = m[2]!.toUpperCase();
  const mi = SABRE_MONTHS.indexOf(mon as (typeof SABRE_MONTHS)[number]);
  if (mi < 0) return sabreDate;
  const y = 2026;
  const d = new Date(Date.UTC(y, mi, day));
  d.setUTCDate(d.getUTCDate() + deltaDays);
  const nd = d.getUTCDate();
  const nm = SABRE_MONTHS[d.getUTCMonth()]!;
  return `${nd}${nm}`;
}

type Chunk = {
  intent: string;
  type?: string;
  dsl_signature?: string;
};

type DatasetRow = {
  query: string;
  intent: string;
  command: string;
  dsl_signature?: string;
  /** Messy / adversarial phrasing; use for eval subsets */
  hard?: boolean;
};

// --- Expanded reference data (IATA-style codes / common Sabre spellings) ---

/** City code → canonical city name for NL */
const CITY_CODES: Record<string, string> = {
  FRA: "Frankfurt",
  MUC: "Munich",
  LHR: "London",
  LGW: "London Gatwick",
  CDG: "Paris",
  ORY: "Paris Orly",
  AMS: "Amsterdam",
  ZRH: "Zurich",
  VIE: "Vienna",
  BRU: "Brussels",
  MAD: "Madrid",
  BCN: "Barcelona",
  LIS: "Lisbon",
  FCO: "Rome",
  MXP: "Milan",
  ATH: "Athens",
  IST: "Istanbul",
  DUB: "Dublin",
  MAN: "Manchester",
  EDI: "Edinburgh",
  ARN: "Stockholm",
  OSL: "Oslo",
  CPH: "Copenhagen",
  HEL: "Helsinki",
  WAW: "Warsaw",
  PRG: "Prague",
  BUD: "Budapest",
  JFK: "New York",
  EWR: "Newark",
  LAX: "Los Angeles",
  SFO: "San Francisco",
  SEA: "Seattle",
  ORD: "Chicago",
  ATL: "Atlanta",
  DFW: "Dallas Fort Worth",
  IAH: "Houston",
  MIA: "Miami",
  BOS: "Boston",
  DEN: "Denver",
  PHX: "Phoenix",
  LAS: "Las Vegas",
  YVR: "Vancouver",
  YYZ: "Toronto",
  YUL: "Montreal",
  MEX: "Mexico City",
  GRU: "Sao Paulo",
  BOG: "Bogota",
  LIM: "Lima",
  SCL: "Santiago",
  DXB: "Dubai",
  DOH: "Doha",
  AUH: "Abu Dhabi",
  TLV: "Tel Aviv",
  CAI: "Cairo",
  JNB: "Johannesburg",
  CPT: "Cape Town",
  NBO: "Nairobi",
  BOM: "Mumbai",
  DEL: "Delhi",
  BLR: "Bangalore",
  SIN: "Singapore",
  BKK: "Bangkok",
  HKG: "Hong Kong",
  TPE: "Taipei",
  NRT: "Tokyo Narita",
  HND: "Tokyo Haneda",
  ICN: "Seoul",
  SYD: "Sydney",
  MEL: "Melbourne",
  AKL: "Auckland",
};

const CITY_CODE_LIST = Object.keys(CITY_CODES);

/** Airport names as entered after W/-AP (uppercased in command; spaces kept where Sabre allows) */
const AIRPORT_NAMES = [
  "Heathrow",
  "Charles de Gaulle",
  "John F Kennedy",
  "Los Angeles International",
  "San Francisco International",
  "O Hare",
  "Frankfurt Airport",
  "Munich Airport",
  "Amsterdam Schiphol",
  "Dubai International",
  "Hamad International",
  "Changi",
  "Incheon International",
  "Haneda",
  "Narita",
  "Sydney Kingsford Smith",
  "Toronto Pearson",
  "Vancouver International",
  "Barajas",
  "El Prat",
  "Leonardo da Vinci Fiumicino",
  "Keflavik",
  "Vienna International",
  "Copenhagen Airport",
  "Zurich Airport",
  "Dublin Airport",
  "Athens International",
  "Lisbon Airport",
];

const AIRLINES = [
  "Lufthansa",
  "Air France",
  "Delta Air Lines",
  "American Airlines",
  "United Airlines",
  "British Airways",
  "Ryanair",
  "easyJet",
  "Emirates",
  "Qatar Airways",
  "Singapore Airlines",
  "Cathay Pacific",
  "ANA",
  "Japan Airlines",
  "KLM",
  "Iberia",
  "Turkish Airlines",
  "Air Canada",
  "JetBlue",
  "Southwest Airlines",
  "Alaska Airlines",
  "Qantas",
  "Virgin Atlantic",
  "Air India",
  "Ethiopian Airlines",
  "LATAM",
  "Aeromexico",
  "WestJet",
  "Wizz Air",
  "Aegean Airlines",
  "TAP Air Portugal",
  "SAS",
  "Finnair",
  "El Al",
  "Egyptair",
];

/** 2-letter airline codes for decode_airline */
const AIRLINE_CODES: Record<string, string> = {
  LH: "Lufthansa",
  AF: "Air France",
  DL: "Delta",
  AA: "American Airlines",
  UA: "United Airlines",
  BA: "British Airways",
  FR: "Ryanair",
  U2: "easyJet",
  EK: "Emirates",
  QR: "Qatar Airways",
  SQ: "Singapore Airlines",
  CX: "Cathay Pacific",
  NH: "ANA",
  JL: "Japan Airlines",
  KL: "KLM",
  IB: "Iberia",
  TK: "Turkish Airlines",
  AC: "Air Canada",
  B6: "JetBlue",
  WN: "Southwest Airlines",
  AS: "Alaska Airlines",
  QF: "Qantas",
  VS: "Virgin Atlantic",
  ET: "Ethiopian Airlines",
  LA: "LATAM",
  AM: "Aeromexico",
  WS: "WestJet",
};

const AIRCRAFT_ENCODE = [
  "AIRBUS A320",
  "AIRBUS A321",
  "AIRBUS A350",
  "BOEING 737",
  "BOEING 777",
  "BOEING 787",
  "BOEING 747",
  "EMBRAER 190",
  "ATR 72",
  "DASH 8",
];

/** Equipment codes for W/EQ* */
const EQUIPMENT_DECODE = ["320", "321", "350", "737", "738", "777", "787", "744", "763", "E90", "77W"];

const SABRE_DATES = [
  "12DEC",
  "13DEC",
  "01JAN",
  "15JAN",
  "28FEB",
  "10MAR",
  "22APR",
  "05MAY",
  "18JUN",
  "30JUL",
  "14AUG",
  "25SEP",
  "08OCT",
  "19NOV",
];

const TIMES = ["11A", "2P", "6P", "830A", "945P", ""];

const US_CITY_STATE: { city: string; st: string }[] = [
  { city: "Columbus", st: "OH" },
  { city: "Dallas", st: "TX" },
  { city: "Miami", st: "FL" },
  { city: "Houston", st: "TX" },
  { city: "Atlanta", st: "GA" },
  { city: "Chicago", st: "IL" },
  { city: "Seattle", st: "WA" },
  { city: "Phoenix", st: "AZ" },
  { city: "Boston", st: "MA" },
  { city: "Denver", st: "CO" },
  { city: "Portland", st: "OR" },
  { city: "Austin", st: "TX" },
];

const INTL_CITY_COUNTRY: { city: string; cc: string }[] = [
  { city: "Vancouver", cc: "CA" },
  { city: "Toronto", cc: "CA" },
  { city: "Montreal", cc: "CA" },
  { city: "Paris", cc: "FR" },
  { city: "London", cc: "GB" },
  { city: "Sydney", cc: "AU" },
  { city: "Melbourne", cc: "AU" },
  { city: "Tokyo", cc: "JP" },
  { city: "Singapore", cc: "SG" },
  { city: "Bangkok", cc: "TH" },
  { city: "Cairo", cc: "EG" },
  { city: "Johannesburg", cc: "ZA" },
];

const MILITARY_BASES: { name: string; state?: string }[] = [
  { name: "FORT HOOD", state: "TX" },
  { name: "FORT BLISS", state: "TX" },
  { name: "CAMP PENDLETON", state: "CA" },
  { name: "FORT BRAGG", state: "NC" },
  { name: "NAVAL STATION NORFOLK", state: "VA" },
  { name: "FORT CAMPBELL", state: "KY" },
];

const AMBIGUOUS_CITIES = [
  "Springfield",
  "Santa Monica",
  "Richmond",
  "Kingston",
  "Alexandria",
  "Portland",
  "Franklin",
  "Clinton",
];

// --- helpers ---

function random<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)] as T;
}

function randomDifferent<T>(arr: readonly T[], exclude: T): T {
  let v: T;
  do {
    v = random(arr);
  } while (v === exclude);
  return v;
}

function sabreCityName(name: string): string {
  return name.toUpperCase().replace(/\s+/g, "");
}

function sabreAirportToken(name: string): string {
  return name.toUpperCase().replace(/\s+/g, "");
}

function sabreAirlineToken(name: string): string {
  return name.toUpperCase().replace(/\s+/g, "");
}

function monthNameLong(mon: string): string {
  const i = SABRE_MONTHS.indexOf(mon.toUpperCase() as (typeof SABRE_MONTHS)[number]);
  const names = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  return i >= 0 ? names[i]! : mon;
}

/** NL for 1R22NOV-style commands (no Sabre literal in text). */
function nlReturnDifferentMonth(cmd: string): string {
  const m = cmd.match(/^1R(\d{1,2})([A-Z]{3})$/i);
  if (!m) return `return on a specific day in another month than the outbound`;
  const day = Number.parseInt(m[1]!, 10);
  const mon = m[2]!.toUpperCase();
  return `return on ${monthNameLong(mon)} ${day}`;
}

/** NL for 1R22NOV10A-style commands (no Sabre literal in text). */
function nlReturnDateAndTime(cmd: string): string {
  const m = cmd.match(/^1R(\d{1,2})([A-Z]{3})(\d{1,4}[AP])$/i);
  if (!m) return `return on a specific calendar date with a stated departure time preference`;
  const day = Number.parseInt(m[1]!, 10);
  const mon = m[2]!.toUpperCase();
  const timePart = m[3]!.toUpperCase();
  const band = /P$/.test(timePart) ? "afternoon or evening" : "morning";
  return `return on ${monthNameLong(mon)} ${day} with a ${band} departure preference`;
}

function nlReturnDifferentMonthExtra(cmd: string): string {
  const m = cmd.match(/^1R(\d{1,2})([A-Z]{3})$/i);
  if (!m) return "cross-month return without restating the outbound line";
  const day = Number.parseInt(m[1]!, 10);
  const mon = m[2]!.toUpperCase();
  return `not a same-day gimmick — calendar return in ${monthNameLong(mon)}, emphasis on day ${day}`;
}

function nlReturnDateAndTimeExtra(cmd: string): string {
  const m = cmd.match(/^1R(\d{1,2})([A-Z]{3})(\d{1,4}[AP])$/i);
  if (!m) return "pin both return calendar day and departure time-of-day in one availability pull";
  const day = Number.parseInt(m[1]!, 10);
  const mon = m[2]!.toUpperCase();
  const timePart = m[3]!.toUpperCase();
  const band = /P$/.test(timePart) ? "afternoon or evening" : "morning";
  return `fax/email bundle: return ${monthNameLong(mon)} ${day}, and they underlined ${band} bank matching the ${timePart} hint from inventory`;
}

/** "12DEC" → "December 12" for NL without Sabre date tokens. */
function sabreDateToEnglish(sabreDate: string): string {
  const m = sabreDate.match(/^(\d{1,2})([A-Z]{3})$/i);
  if (!m) return sabreDate;
  const day = Number.parseInt(m[1]!, 10);
  const mon = m[2]!.toUpperCase();
  return `${monthNameLong(mon)} ${day}`;
}

function intentMeta(chunks: Chunk[], intent: string): { dsl_signature?: string } {
  const c = chunks.find((x) => x.intent === intent && x.type === "command");
  return { dsl_signature: c?.dsl_signature };
}

/** True when the query is essentially the Sabre entry typed verbatim (case/spacing only differ). Fragments inside longer NL stay allowed. */
function isSabreCommandEcho(query: string, command: string): boolean {
  const norm = (s: string) => s.trim().replace(/\s+/g, "").toUpperCase();
  return norm(query) === norm(command);
}

function addRows(
  out: DatasetRow[],
  intent: string,
  dsl: string | undefined,
  queries: string[],
  command: string,
  hard?: boolean,
) {
  for (const query of queries) {
    if (isSabreCommandEcho(query, command)) continue;
    out.push({ query, intent, command, dsl_signature: dsl, ...(hard ? { hard: true } : {}) });
  }
}

const NOISE_PREFIXES = [
  "Urgent — ",
  "While you’re here, ",
  "Not sure if this is the right queue but ",
  "Ignore the email thread title; ",
  "Supervisor listening in — ",
  "PNR mess aside, ",
  "Policy says ‘cheapest’ but for this keystroke only: ",
];

const NOISE_INFIX = [
  " — and please ignore alliance / interline filters I mentioned earlier — ",
  " (if the filter UI shows ‘nonstop only’, disregard; the host entry we need stays the same) ",
  " …customer also ranted about baggage but that’s not part of this — ",
  " — fare basis noise in the remarks, ignore — ",
  " (treat ‘premium economy’ chatter as irrelevant for this command) ",
];

const NOISE_SUFFIXES = [
  " …thanks, that’s the only action I need right now.",
  " — nothing else on the PNR for this step.",
  " (downline will handle seats.)",
  " [ignore corporate policy ID in remarks]",
  " — sorry for the wall of text.",
];

function entangleQuery(core: string): string {
  return `${random(NOISE_PREFIXES)}${core}${random(NOISE_INFIX)}${random(NOISE_SUFFIXES)}`;
}

/** One noisy row: same command as a random clean sample, query wrapped in distractors. */
function genConvolutedRow(
  intent: string,
  dsl: string | undefined,
): DatasetRow | null {
  const batch = genRowsForIntent(intent, dsl);
  if (batch.length === 0) return null;
  const base = random(batch);
  return {
    ...base,
    query: entangleQuery(base.query),
    hard: true,
  };
}

function filterHardCasesForChunks(commandIntentSet: Set<string>): DatasetRow[] {
  return MANUAL_HARD_CASES.filter((r) => commandIntentSet.has(r.intent)) as DatasetRow[];
}

function generateConvolutedBatch(
  commandIntents: string[],
  chunks: Chunk[],
  count: number,
): DatasetRow[] {
  const out: DatasetRow[] = [];
  if (count <= 0) return out;
  for (let i = 0; i < count; i++) {
    const intent = random(commandIntents);
    const { dsl_signature } = intentMeta(chunks, intent);
    const row = genConvolutedRow(intent, dsl_signature);
    if (row) out.push(row);
  }
  return out;
}

// --- per-intent generators (only command intents from chunks) ---

function genRowsForIntent(intent: string, dsl: string | undefined): DatasetRow[] {
  const rows: DatasetRow[] = [];

  switch (intent) {
    case "encode_city": {
      const name = random(Object.values(CITY_CODES));
      const cmd = `W/-CC${sabreCityName(name)}`;
      addRows(rows, intent, dsl, [
        `what is the city code for ${name}`,
        `find city code ${name}`,
        `encode city ${name}`,
        `iata code for ${name}`,
      ], cmd);
      break;
    }
    case "encode_airport": {
      const ap = random(AIRPORT_NAMES);
      const cmd = `W/-AP${sabreAirportToken(ap)}`;
      addRows(rows, intent, dsl, [
        `what is the airport code for ${ap}`,
        `find airport code ${ap}`,
        `encode airport ${ap}`,
      ], cmd);
      break;
    }
    case "encode_airline": {
      const al = random(AIRLINES);
      const cmd = `W/-AL${sabreAirlineToken(al)}`;
      addRows(rows, intent, dsl, [
        `what is the airline code for ${al}`,
        `find airline code ${al}`,
        `encode airline ${al}`,
        `carrier code ${al}`,
      ], cmd);
      break;
    }
    case "encode_aircraft_type": {
      const t = random(AIRCRAFT_ENCODE);
      const cmd = `W/EQ-${t}`;
      addRows(rows, intent, dsl, [
        `what is the equipment code for ${t.replace("AIRBUS ", "an Airbus ").replace("BOEING ", "a Boeing ").toLowerCase()}`,
        `encode aircraft ${t}`,
      ], cmd);
      break;
    }
    case "decode_city_airport": {
      const code = random(CITY_CODE_LIST);
      const cmd = `W/*${code}`;
      addRows(rows, intent, dsl, [
        `what city is ${code}`,
        `decode airport code ${code}`,
        `translate ${code} airport code`,
        `what does the three-letter ${code} stand for on this segment`,
      ], cmd);
      break;
    }
    case "decode_airline": {
      const code = random(Object.keys(AIRLINE_CODES));
      const cmd = `W/*${code}`;
      addRows(rows, intent, dsl, [
        `which airline is ${code}`,
        `decode airline code ${code}`,
        `what does carrier ${code} mean`,
        `who operates under designator ${code}`,
      ], cmd);
      break;
    }
    case "decode_aircraft_type": {
      const eq = random(EQUIPMENT_DECODE);
      const cmd = `W/EQ*${eq}`;
      addRows(rows, intent, dsl, [
        `what aircraft is equipment code ${eq}`,
        `decode equipment ${eq}`,
        `plain-language type behind equipment ${eq}`,
      ], cmd);
      break;
    }
    case "find_closest_airports_state": {
      const { city, st } = random(US_CITY_STATE);
      const cmd = `W/-CY${city.toUpperCase()}, ${st}`;
      addRows(rows, intent, dsl, [
        `closest airports to ${city} ${st}`,
        `airports near ${city} in ${st}`,
        `ten nearest fields to ${city} with state ${st}`,
      ], cmd);
      break;
    }
    case "find_closest_airports_country": {
      const { city, cc } = random(INTL_CITY_COUNTRY);
      const cmd = `W/-CY${city.toUpperCase()}, ${cc}`;
      addRows(rows, intent, dsl, [
        `closest airports to ${city} ${cc}`,
        `nearest airports to ${city} in country ${cc}`,
        `alternate fields near ${city} using country ${cc}`,
      ], cmd);
      break;
    }
    case "find_closest_airports_airport": {
      const code = random(CITY_CODE_LIST);
      const cmd = `W/-AT${code}`;
      addRows(rows, intent, dsl, [
        `airports close to ${code}`,
        `find nearby airports to ${code}`,
        `alternates around hub ${code}`,
      ], cmd);
      break;
    }
    case "find_closest_airports_military": {
      const b = random(MILITARY_BASES);
      const cmd = b.state ? `W/-MB${b.name},${b.state}` : `W/-MB${b.name}`;
      addRows(rows, intent, dsl, [
        `closest airport to ${b.name.replaceAll("_", " ").toLowerCase()}`,
        `airports near military base ${b.name}`,
        `commercial alternates near base ${b.name.replaceAll("_", " ").toLowerCase()}`,
      ], cmd);
      break;
    }
    case "distance_between_airports": {
      const a = random(CITY_CODE_LIST);
      const b = randomDifferent(CITY_CODE_LIST, a);
      const cmd = `W/-AT${a}${CHUNK_DISTANCE_SEP}AT${b}`;
      addRows(rows, intent, dsl, [
        `distance between ${a} and ${b}`,
        `mileage from ${a} to ${b}`,
        `great-circle style mileage airport ${a} to airport ${b}`,
      ], cmd);
      break;
    }
    case "display_similar_name_list": {
      const city = random(AMBIGUOUS_CITIES);
      const cmd = `W/-CY${city.toUpperCase().replace(/\s+/g, " ")}`;
      addRows(rows, intent, dsl, [
        `find city ${city} without state`,
        `list cities named ${city}`,
        `ambiguous name ${city} need disambiguation list`,
      ], cmd);
      break;
    }
    case "select_similar_name_list": {
      const n = String(random([1, 2, 3, 4, 5, 6, 7, 8, 9]));
      const cmd = `W/-SL${n}`;
      addRows(rows, intent, dsl, [
        `select line ${n} from similar names`,
        `pick city option ${n}`,
        `choose row ${n} on the name list`,
      ], cmd);
      break;
    }
    case "redisplay_similar_name_list": {
      addRows(rows, intent, dsl, ["show similar city names again", "redisplay name list", "bring back the city pick list"], "W/-SL*");
      break;
    }
    case "request_flight_availability": {
      const from = random(CITY_CODE_LIST);
      const to = randomDifferent(CITY_CODE_LIST, from);
      const date = random(SABRE_DATES);
      const time = random(TIMES);
      const cmd = `1${date}${from}${to}${time}`;
      const fn = CITY_CODES[from] ?? from;
      const tn = CITY_CODES[to] ?? to;
      addRows(rows, intent, dsl, [
        `find flights from ${fn} to ${tn} on ${sabreDateToEnglish(date)}`,
        `show flights ${fn} ${tn} ${sabreDateToEnglish(date)}`,
        `any flights from ${from} to ${to} ${sabreDateToEnglish(date)}`,
        `flights ${fn} to ${tn} ${sabreDateToEnglish(date)}${time ? ` around ${time}` : ""}`.trim(),
        `I need a flight from ${fn} to ${tn} on ${sabreDateToEnglish(date)}`,
        `what flights go from ${from} to ${to} on ${sabreDateToEnglish(date)}`,
        `tickets ${fn} to ${tn} ${sabreDateToEnglish(date)}`,
      ], cmd);
      break;
    }
    case "request_additional_availability": {
      addRows(rows, intent, dsl, ["show more flights", "next page availability", "scroll for more CPA rows"], "1*");
      break;
    }
    case "redisplay_last_availability": {
      addRows(rows, intent, dsl, ["redisplay last flight search", "bring back availability", "restore the last availability matrix"], "1*R");
      break;
    }
    case "change_departure_time": {
      const t = random(["2P", "4P", "10A", "6P", "830A"]);
      const cmd = `1*${t}`;
      addRows(rows, intent, dsl, [`change search to ${t}`, `flights at ${t}`, `shift the CPA departure time preference to ${t}`], cmd);
      break;
    }
    case "add_days_to_availability": {
      const d = random([1, 2, 3, 5, 7]);
      const from = random(CITY_CODE_LIST);
      const to = randomDifferent(CITY_CODE_LIST, from);
      const baseDate = random(SABRE_DATES);
      const time = random(TIMES);
      const newDate = addDaysToSabreDate(baseDate, d);
      const cmd = `1${newDate}${from}${to}${time}`;
      addRows(rows, intent, dsl, [`add ${d} days to availability`, `search ${d} days later`, `move the CPA date forward by ${d} days`], cmd);
      break;
    }
    case "subtract_days_from_availability": {
      const d = random([1, 2, 3, 4, 7]);
      const cmd = `1-${d}`;
      addRows(rows, intent, dsl, [`go back ${d} days`, `subtract ${d} days`, `move the CPA date backward by ${d} days`], cmd);
      break;
    }
    case "change_arrival_city": {
      const c = random(CITY_CODE_LIST);
      const cmd = `1*A${c}`;
      addRows(rows, intent, dsl, [`change destination to ${c}`, `arrival city ${c}`, `swap arrival to ${c} only`], cmd);
      break;
    }
    case "change_departure_city": {
      const c = random(CITY_CODE_LIST);
      const cmd = `1*D${c}`;
      addRows(rows, intent, dsl, [`change origin to ${c}`, `departure city ${c}`, `swap departure to ${c} only`], cmd);
      break;
    }
    case "change_city_pair": {
      const a = random(CITY_CODE_LIST);
      const b = randomDifferent(CITY_CODE_LIST, a);
      const cmd = `1*${a}${b}`;
      addRows(rows, intent, dsl, [`change route to ${a} ${b}`, `new city pair ${a} ${b}`, `retain timing but fly ${a} to ${b}`], cmd);
      break;
    }
    case "redisplay_original_availability": {
      addRows(rows, intent, dsl, ["show original availability", "reset flight search display", "undo CPA tweaks and show first matrix"], "1*OA");
      break;
    }
    case "display_additional_classes": {
      addRows(rows, intent, dsl, ["show more booking classes", "additional classes", "expand booking buckets on this CPA"], "1*C");
      break;
    }
    case "request_return_availability_time": {
      const t = random(["6P", "8P", "10A", "2P"]);
      const cmd = `1R${t}`;
      addRows(rows, intent, dsl, [`return flight at ${t}`, `same day return ${t}`, `same-date return with departure bias ${t}`], cmd);
      break;
    }
    case "request_return_availability_add_days": {
      /** `1R‡N` is rejected as FORMAT over SOAP/cert; absolute `1RDDMMM` validates (NO_PRIOR_CPA only). */
      const cmd = random([
        "1R07JAN",
        "1R15DEC",
        "1R22NOV",
        "1R01JUN",
        "1R18SEP",
        "1R28FEB",
        "1R12APR",
        "1R30OCT",
      ]);
      addRows(rows, intent, dsl, [nlReturnDifferentMonth(cmd), nlReturnDifferentMonthExtra(cmd)], cmd);
      break;
    }
    case "request_return_availability_sub_days": {
      const d = random([2, 3, 5, 7]);
      const cmd = `1R-${d}`;
      addRows(rows, intent, dsl, [`return ${d} days earlier`, `pull return date in by ${d} days`], cmd);
      break;
    }
    case "request_return_availability_add_days_time": {
      /** Avoid `1R‡N*T` (FORMAT over SOAP); use month+day+time form that validates. */
      const cmd = random([
        "1R22NOV10A",
        "1R07JAN2P",
        "1R15DEC6P",
        "1R10MAR830A",
        "1R05JUN945P",
        "1R18SEP10A",
      ]);
      addRows(rows, intent, dsl, [nlReturnDateAndTime(cmd), nlReturnDateAndTimeExtra(cmd)], cmd);
      break;
    }
    case "request_return_availability_sub_days_time": {
      const d = random([3, 5]);
      const t = random(["2P", "9A", "4P"]);
      const cmd = `1R-${d}*${t}`;
      addRows(rows, intent, dsl, [`return ${d} days earlier at ${t}`, `combined backward shift ${d} days and time ${t} on return`], cmd);
      break;
    }
    case "request_return_availability_date": {
      const day = random([5, 12, 15, 22, 25, 28]);
      const cmd = `1R${day}`;
      addRows(rows, intent, dsl, [`return on the ${day}th this month`, `same-month return pinned to day ${day}`], cmd);
      break;
    }
    case "request_return_availability_month": {
      const cmd = random(["1R22NOV", "1R15DEC", "1R10JAN", "1R05MAR"]);
      addRows(rows, intent, dsl, [nlReturnDifferentMonth(cmd), nlReturnDifferentMonthExtra(cmd)], cmd);
      break;
    }
    case "request_return_availability_date_time": {
      const cmd = random(["1R22NOV10A", "1R15DEC2P", "1R10JAN8A"]);
      addRows(rows, intent, dsl, [nlReturnDateAndTime(cmd), nlReturnDateAndTimeExtra(cmd)], cmd);
      break;
    }
    case "verify_flight_info_from_cpa": {
      const n = random([1, 2, 3, 4, 5]);
      const cmd = `VA*${n}`;
      addRows(rows, intent, dsl, [`verify flight line ${n}`, `equipment and stops for CPA row ${n}`], cmd);
      break;
    }
    case "verify_flight_info_range": {
      const cmd = random(["VA*1-3", "VA*2-4", "VA*1-5"]);
      addRows(rows, intent, dsl, [
        `verify lines ${cmd.replace("VA*", "")} as one contiguous block`,
        `segment sweep for lines ${cmd.replace("VA*", "")}`,
      ], cmd);
      break;
    }
    case "verify_flight_info_specific": {
      const cmd = random(["VA*1/4", "VA*2/5", "VA*1/3"]);
      addRows(rows, intent, dsl, [
        `verify lines ${cmd.replace("VA*", "").replace("/", " and ")} separately`,
        `non-contiguous CPA rows ${cmd.replace("VA*", "").replace("/", " and ")} need detail`,
      ], cmd);
      break;
    }
    default:
      break;
  }

  return rows;
}

function parseArgs(argv: string[]) {
  const scriptDir = import.meta.dir;
  const packageRoot = path.join(scriptDir, "..");
  const repoRoot = path.join(packageRoot, "..");
  let chunks = path.join(repoRoot, "chunks.json");
  let out = path.join(packageRoot, "data", "validation-dataset.json");
  let rounds = 35;
  /** Extra rows: clean query wrapped in distractors / fake filters */
  let hard = 100;

  for (let i = 2; i < argv.length; i++) {
    const next = () => {
      const v = argv[++i];
      return v ?? "";
    };
    if (argv[i] === "--chunks") {
      const v = next();
      if (v) chunks = path.resolve(v);
    } else if (argv[i] === "--out") {
      const v = next();
      if (v) out = path.resolve(v);
    } else if (argv[i] === "--rounds") {
      const v = next();
      rounds = Math.max(1, Number.parseInt(v, 10) || 35);
    } else if (argv[i] === "--hard") {
      const v = next();
      hard = Math.max(0, Number.parseInt(v, 10) || 0);
    }
  }

  return { chunks, out, rounds, hard };
}

function main() {
  const { chunks: chunksPath, out: outPath, rounds, hard } = parseArgs(process.argv);

  const raw = fs.readFileSync(chunksPath, "utf8");
  const chunks = JSON.parse(raw) as Chunk[];

  const commandIntents = [
    ...new Set(
      chunks.filter((c) => c.type === "command").map((c) => c.intent),
    ),
  ];

  const commandIntentSet = new Set(commandIntents);

  const dataset: DatasetRow[] = [];

  for (let r = 0; r < rounds; r++) {
    for (const intent of commandIntents) {
      const { dsl_signature } = intentMeta(chunks, intent);
      dataset.push(...genRowsForIntent(intent, dsl_signature));
    }
  }

  const manualHard = filterHardCasesForChunks(commandIntentSet);
  dataset.push(...manualHard);
  dataset.push(...generateConvolutedBatch(commandIntents, chunks, hard));

  const hardCount = dataset.filter((r) => r.hard).length;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(dataset, null, 2)}\n`);
  console.error(
    `Wrote ${dataset.length} rows (${commandIntents.length} command intents × rounds=${rounds}; hard manual=${manualHard.length}, hard noisy=${hard}; total hard flagged=${hardCount}) → ${outPath}`,
  );
}

main();
