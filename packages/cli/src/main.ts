import * as readline from "node:readline/promises";

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

function parseArgv(argv: string[]): { debug: boolean; queryParts: string[] } {
	let debug = false;
	const queryParts: string[] = [];
	for (const a of argv) {
		if (a === "--debug" || a === "-d") {
			debug = true;
			continue;
		}
		queryParts.push(a);
	}
	return { debug, queryParts };
}

function printDebug(lines: string[] | undefined): void {
	if (!lines?.length) return;
	for (const line of lines) {
		console.error(`[debug] ${line}`);
	}
}

async function translate(
	query: string,
	debug: boolean,
): Promise<void> {
	const root = baseUrl();
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};
	if (debug) headers["X-Assistant-Debug"] = "1";

	const res = await fetch(`${root}/translate`, {
		method: "POST",
		headers,
		body: JSON.stringify({ query }),
	});

	const payload = (await res.json()) as {
		command?: string;
		error?: string;
		truncated?: boolean;
		debug?: string[];
	};

	if (!res.ok) {
		console.error(`Error (${res.status}): ${payload.error ?? res.statusText}`);
		process.exitCode = 1;
		return;
	}

	if (debug) printDebug(payload.debug);

	if (payload.truncated) {
		console.error("(query was truncated to max token length)");
	}
	console.log(payload.command ?? "");
}

const rawArgv = process.argv.slice(2);
const { debug: flagDebug, queryParts } = parseArgv(rawArgv);
const envDebug =
	process.env.CLI_DEBUG === "1" || process.env.CLI_DEBUG === "true";
const oneShot = queryParts.join(" ").trim();

if (oneShot) {
	const debug = flagDebug || envDebug;
	console.error(`POST translate${debug ? " (debug)" : ""}`);
	await translate(oneShot, debug);
	process.exit(process.exitCode ?? 0);
}

const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout,
});

let interactiveDebug = flagDebug || envDebug;

console.log("Travel Operator Assistant CLI");
console.log("POST translate");
if (interactiveDebug) console.log("Debug: on (set CLI_DEBUG=0 or restart without --debug to disable)");
console.log('Type a natural language query, or "exit" to quit.\n');

while (true) {
	const query = await rl.question("travel> ");
	const trimmed = query.trim();

	if (!trimmed) continue;
	if (trimmed === "exit" || trimmed === "quit") {
		console.log("Bye!");
		break;
	}

	try {
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		};
		if (interactiveDebug) headers["X-Assistant-Debug"] = "1";

		const res = await fetch(`${baseUrl()}/translate`, {
			method: "POST",
			headers,
			body: JSON.stringify({ query: trimmed }),
		});

		const data = (await res.json()) as {
			command?: string;
			error?: string;
			truncated?: boolean;
			debug?: string[];
		};

		if (!res.ok) {
			console.log(`  Error (${res.status}): ${data.error ?? res.statusText}`);
			continue;
		}

		if (interactiveDebug) {
			if (data.debug?.length) {
				for (const line of data.debug) {
					console.log(`  [debug] ${line}`);
				}
			}
		}

		if (data.truncated) {
			console.log("  (query was truncated)\n");
		}
		console.log(`  => ${data.command}\n`);
	} catch (err) {
		console.log(
			`  Connection error: ${err instanceof Error ? err.message : String(err)}`,
		);
		console.log(`  Check ASSISTANT_API_URL or run assistant locally.\n`);
	}
}

rl.close();
