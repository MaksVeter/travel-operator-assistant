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

async function translate(query: string): Promise<void> {
	const root = baseUrl();
	const res = await fetch(`${root}/translate`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ query }),
	});

	const payload = (await res.json()) as {
		command?: string;
		error?: string;
		truncated?: boolean;
	};

	if (!res.ok) {
		console.error(`Error (${res.status}): ${payload.error ?? res.statusText}`);
		process.exitCode = 1;
		return;
	}

	if (payload.truncated) {
		console.error("(query was truncated to max token length)");
	}
	console.log(payload.command ?? "");
}

const oneShot = process.argv.slice(2).join(" ").trim();

if (oneShot) {
	console.error(`POST ${baseUrl()}/translate`);
	await translate(oneShot);
	process.exit(process.exitCode ?? 0);
}

const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout,
});

console.log("Travel Operator Assistant CLI");
console.log(`API base: ${baseUrl()}`);
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
		const res = await fetch(`${baseUrl()}/translate`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ query: trimmed }),
		});

		const data = (await res.json()) as {
			command?: string;
			error?: string;
			truncated?: boolean;
		};

		if (!res.ok) {
			console.log(`  Error (${res.status}): ${data.error ?? res.statusText}`);
			continue;
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
