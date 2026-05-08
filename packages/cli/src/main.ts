import * as readline from "node:readline/promises";

const ASSISTANT_URL = process.env.ASSISTANT_URL ?? "http://localhost:3000";

const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout,
});

console.log("Travel Operator Assistant CLI");
console.log(`Connected to: ${ASSISTANT_URL}`);
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
		const res = await fetch(`${ASSISTANT_URL}/translate`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ query: trimmed }),
		});

		if (!res.ok) {
			const err = (await res.json()) as { error?: string };
			console.log(`  Error: ${err.error ?? res.statusText}`);
			continue;
		}

		const data = (await res.json()) as { command: string };
		console.log(`  => ${data.command}\n`);
	} catch (err) {
		console.log(
			`  Connection error: ${err instanceof Error ? err.message : String(err)}`,
		);
		console.log(`  Make sure assistant server is running at ${ASSISTANT_URL}\n`);
	}
}

rl.close();
