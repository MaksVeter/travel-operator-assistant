import * as readline from "node:readline/promises";

type HistoryTurn = {
	query: string;
	command: string;
};

function pickBaseUrl(): string | undefined {
	for (const key of ["ASSISTANT_API_URL", "ASSISTANT_URL"] as const) {
		const v = process.env[key]?.trim();
		if (v) return v.replace(/\/$/, "");
	}
	return undefined;
}

function baseUrl(): string {
	return pickBaseUrl() ?? "http://localhost:3000";
}

function parseArgv(argv: string[]): {
	debug: boolean;
	v2: boolean;
	queryParts: string[];
} {
	let debug = false;
	let v2 = false;
	const queryParts: string[] = [];
	for (const a of argv) {
		if (a === "--debug" || a === "-d") {
			debug = true;
			continue;
		}
		if (a === "--v2") {
			v2 = true;
			continue;
		}
		queryParts.push(a);
	}
	return { debug, v2, queryParts };
}

function printDebug(debug: unknown): void {
	if (!debug) return;
	if (Array.isArray(debug)) {
		for (const line of debug) {
			console.error(`  [debug] ${line}`);
		}
	} else if (typeof debug === "object") {
		const d = debug as Record<string, unknown>;
		if (d.rewrittenQuery) console.error(`  [rewrite] ${d.rewrittenQuery}`);
		if (d.predictedIntents) {
			const intents = d.predictedIntents as Array<{ intent: string; confidence: number }>;
			console.error(`  [intent] ${intents.map((i) => `${i.intent}(${i.confidence.toFixed(2)})`).join(", ")}`);
		}
		if (d.contextAfterFiltering) {
			console.error(`  [context] ${(d.contextAfterFiltering as string[]).join(", ")}`);
		}
		if (d.latencyMs) {
			const t = d.latencyMs as Record<string, number>;
			console.error(`  [latency] total=${t.total}ms rewrite=${t.rewrite}ms search=${t.search}ms llm=${t.llm}ms`);
		}
	}
}

async function translate(
	query: string,
	debug: boolean,
	useV2: boolean,
	history?: HistoryTurn[],
): Promise<{ command: string; truncated: boolean } | null> {
	const root = baseUrl();
	const endpoint = useV2 ? "/v2/translate" : "/translate";
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};
	if (debug) headers["X-Assistant-Debug"] = "1";

	const body: Record<string, unknown> = { query };
	if (useV2 && history?.length) {
		body.history = history;
	}

	const res = await fetch(`${root}${endpoint}`, {
		method: "POST",
		headers,
		body: JSON.stringify(body),
	});

	const payload = (await res.json()) as {
		command?: string;
		error?: string;
		truncated?: boolean;
		debug?: unknown;
	};

	if (!res.ok) {
		console.error(`Error (${res.status}): ${payload.error ?? res.statusText}`);
		return null;
	}

	if (debug) printDebug(payload.debug);

	if (payload.truncated) {
		console.error("  (query was truncated)");
	}

	return {
		command: payload.command ?? "",
		truncated: payload.truncated === true,
	};
}

const rawArgv = process.argv.slice(2);
const { debug: flagDebug, v2: flagV2, queryParts } = parseArgv(rawArgv);
const envDebug =
	process.env.CLI_DEBUG === "1" || process.env.CLI_DEBUG === "true";
const useV2 = flagV2 || process.env.CLI_V2 === "1";
const oneShot = queryParts.join(" ").trim();

if (oneShot) {
	const debug = flagDebug || envDebug;
	const version = useV2 ? "v2" : "v1";
	console.error(`POST ${version}/translate${debug ? " (debug)" : ""}`);
	const result = await translate(oneShot, debug, useV2);
	if (result) console.log(result.command);
	process.exit(result ? 0 : 1);
}

// Interactive REPL mode
const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout,
});

const interactiveDebug = flagDebug || envDebug;
const sessionHistory: HistoryTurn[] = [];

const version = useV2 ? "V2" : "V1";
console.log(`Travel Operator Assistant CLI (${version})`);
if (useV2) console.log("Session enabled — history sent with each request.");
if (interactiveDebug) console.log("Debug: on");
console.log("");
console.log("Commands:");
console.log("  /clear    — clear session history");
console.log("  /history  — show session history");
console.log("  exit      — quit");
console.log("");

while (true) {
	const query = await rl.question("travel> ");
	const trimmed = query.trim();

	if (!trimmed) continue;
	if (trimmed === "exit" || trimmed === "quit") {
		console.log("Bye!");
		break;
	}

	if (trimmed === "/clear") {
		sessionHistory.length = 0;
		console.log("  Session cleared.\n");
		continue;
	}

	if (trimmed === "/history") {
		if (sessionHistory.length === 0) {
			console.log("  (empty session)\n");
		} else {
			for (const turn of sessionHistory) {
				console.log(`  "${turn.query}" → ${turn.command}`);
			}
			console.log("");
		}
		continue;
	}

	try {
		const result = await translate(
			trimmed,
			interactiveDebug,
			useV2,
			useV2 ? sessionHistory : undefined,
		);

		if (!result) continue;

		console.log(`  => ${result.command}\n`);

		// Save to client-side session (only non-refusal commands for V2)
		if (useV2 && !result.command.startsWith("I cannot build")) {
			sessionHistory.push({ query: trimmed, command: result.command });
			// Keep last 10 turns
			if (sessionHistory.length > 10) {
				sessionHistory.splice(0, sessionHistory.length - 10);
			}
		}
	} catch (err) {
		console.log(
			`  Connection error: ${err instanceof Error ? err.message : String(err)}`,
		);
		console.log(`  Check ASSISTANT_API_URL or run assistant locally.\n`);
	}
}

rl.close();
