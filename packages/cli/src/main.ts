import * as readline from "node:readline/promises";
import { createTerminal } from "./terminal.ts";

type HistoryTurn = {
	query: string;
	command: string;
};

type RetrievedChunk = {
	intent: string;
	score: number;
	dsl_signature: string;
};

type IntentPrediction = {
	intent: string;
	confidence: number;
	dsl_signature?: string;
};

const DEBUG_TOP_CHUNKS = 5;
const STEP_DELAY_MS = Number(process.env.CLI_STEP_DELAY_MS ?? 300);
const SABRE_MAX_LINES = 3;
const term = createTerminal(process.stderr);
const { step, loading, pause: termPause } = term;

async function stepDelay(): Promise<void> {
	await termPause(STEP_DELAY_MS);
}

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
	sabre: boolean;
	queryParts: string[];
} {
	let debug = false;
	let v2 = false;
	let sabre = false;
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
		if (a === "--sabre") {
			sabre = true;
			continue;
		}
		queryParts.push(a);
	}
	return { debug, v2, sabre, queryParts };
}

function isRefusal(command: string): boolean {
	return command.startsWith("I cannot build");
}

function printBlock1(query: string): void {
	step.header(1, "Input query");
	step.highlight(`"${query}"`);
}

function printBlock2(debug: unknown): void {
	step.header(2, "Context search");

	if (!debug) {
		step.dim("(details unavailable — enable --debug)");
	} else if (Array.isArray(debug)) {
		for (const line of debug) {
			step.dim(line);
		}
	} else if (typeof debug === "object") {
		const d = debug as Record<string, unknown>;

		if (d.rewrittenQuery) {
			step.label("rewrite", String(d.rewrittenQuery));
		}

		const intents = d.predictedIntents as IntentPrediction[] | undefined;
		if (intents?.length) {
			const text = intents
				.slice(0, 3)
				.map(
					(i) =>
						`${i.intent} (${i.confidence.toFixed(2)})${i.dsl_signature ? ` → ${i.dsl_signature}` : ""}`,
				)
				.join(", ");
			step.label("intent", text);
		}

		const chunks = d.retrievedChunks as RetrievedChunk[] | undefined;
		if (chunks?.length) {
			step.label("retrieved", `${chunks.length} chunks`);
			for (const c of chunks.slice(0, DEBUG_TOP_CHUNKS)) {
				step.dim(
					`${c.score.toFixed(4)}  ${c.intent.padEnd(36)} ${c.dsl_signature}`,
					6,
				);
			}
			if (chunks.length > DEBUG_TOP_CHUNKS) {
				step.dim(`... ${chunks.length - DEBUG_TOP_CHUNKS} more`, 6);
			}
		}

		const filtered = d.contextAfterFiltering as string[] | undefined;
		if (filtered?.length) {
			step.label("selected", filtered.join(", "));
		}

		const latency = d.latencyMs as Record<string, number> | undefined;
		if (latency?.total) {
			step.label(
				"timing",
				`search ${latency.search ?? "?"}ms · LLM ${latency.llm ?? "?"}ms · total ${latency.total}ms`,
			);
		}
	}
}

function printBlock3(command: string, debug: unknown): void {
	step.header(3, "Command generation");

	if (debug && typeof debug === "object" && !Array.isArray(debug)) {
		const d = debug as Record<string, unknown>;
		if (d.rawLlmOutput && d.rawLlmOutput !== command) {
			step.label("LLM (raw)", String(d.rawLlmOutput));
		}
		if (d.validationApplied) {
			step.label("normalization", "applied");
		}
		if (d.refusalReason) {
			step.label("refusal", String(d.refusalReason));
		}
	}
}

async function printDebugPipeline(
	query: string,
	command: string,
	debug: unknown,
): Promise<void> {
	await stepDelay();
	printBlock1(query);

	await stepDelay();
	printBlock2(debug);

	await stepDelay();
	printBlock3(command, debug);
}

function formatSabreScreen(screen: string | null | undefined): void {
	if (!screen?.trim()) {
		step.dim("(empty response)");
		return;
	}
	const lines = screen.split(/\r?\n/).filter((l) => l.trim().length > 0);
	for (const line of lines.slice(0, SABRE_MAX_LINES)) {
		step.sabreLine(line);
	}
}

async function fetchSabreScreen(
	command: string,
): Promise<{ screen?: string | null; error?: string }> {
	const apiUrl = process.env.SABRE_COMMAND_API_URL?.trim().replace(/\/$/, "");

	if (apiUrl) {
		const res = await fetch(`${apiUrl}/command`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ command, dryRun: true }),
		});
		const payload = (await res.json()) as {
			screen?: string | null;
			error?: string;
		};
		if (!res.ok) {
			return { error: payload.error ?? res.statusText };
		}
		return { screen: payload.screen };
	}

	const { loadSabreConfig } = await import("../../sabre-command/src/config.ts");
	const { runSabreHostCommand } = await import(
		"../../sabre-command/src/sabre-soap.ts"
	);
	const cfg = loadSabreConfig();
	const result = await runSabreHostCommand(cfg, command, {
		discardTransaction: true,
	});
	return { screen: result.screen };
}

async function printSabreBlock(command: string): Promise<void> {
	await stepDelay();
	step.header(4, "Sabre result");

	try {
		const { screen, error } = await loading.run("Sabre", () =>
			fetchSabreScreen(command),
		);
		if (error) {
			step.error(`API error: ${error}`);
			return;
		}
		formatSabreScreen(screen);
	} catch (err) {
		step.error(
			`Sabre error: ${err instanceof Error ? err.message : String(err)}`,
		);
	}

	step.blank();
}

async function presentPipeline(
	query: string,
	result: { command: string; debug?: unknown; truncated?: boolean },
	sabre: boolean,
): Promise<void> {
	await printDebugPipeline(query, result.command, result.debug);

	if (result.truncated) {
		step.dim("(query was truncated)");
	}

	if (sabre && !isRefusal(result.command)) {
		await printSabreBlock(result.command);
	} else if (sabre && isRefusal(result.command)) {
		await stepDelay();
		step.header(4, "Sabre result");
		step.dim("(skipped — no command generated)");
		step.blank();
	}

	await stepDelay();
	printFinalResult(result.command);
}

async function translate(
	query: string,
	debug: boolean,
	useV2: boolean,
	history?: HistoryTurn[],
): Promise<{ command: string; truncated: boolean; debug?: unknown } | null> {
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
		step.error(`Error (${res.status}): ${payload.error ?? res.statusText}`);
		return null;
	}

	const command = payload.command ?? "";

	return {
		command,
		truncated: payload.truncated === true,
		debug: payload.debug,
	};
}

async function runSabreQuiet(command: string): Promise<void> {
	try {
		await fetchSabreScreen(command);
	} catch {
		// non-debug mode: ignore Sabre errors on stderr
	}
}

function printFinalResult(command: string): void {
	term.finalResult(command);
}

function printHelp(version: string, session: boolean): void {
	term.welcome({
		version,
		debug: true,
		sabre: true,
		session,
	});
}

const rawArgv = process.argv.slice(2);
const { debug: flagDebug, v2: flagV2, sabre: flagSabre, queryParts } =
	parseArgv(rawArgv);
const envDebug =
	process.env.CLI_DEBUG === "1" || process.env.CLI_DEBUG === "true";
const envSabre =
	process.env.CLI_SABRE === "1" || process.env.CLI_SABRE === "true";
const useV2 = flagV2 || process.env.CLI_V2 === "1";
const oneShot = queryParts.join(" ").trim();

if (oneShot) {
	const debug = flagDebug || envDebug;
	const sabre = flagSabre || envSabre;
	const result = await loading.run("Processing", () =>
		translate(oneShot, debug, useV2),
	);
	if (result) {
		if (debug) {
			await presentPipeline(oneShot, result, sabre);
		} else {
			console.log(result.command);
			if (sabre && !isRefusal(result.command)) {
				await runSabreQuiet(result.command);
			}
		}
	}
	process.exit(result ? 0 : 1);
}

// Interactive REPL mode
const interactiveDebug = flagDebug || envDebug;
const interactiveSabre = flagSabre || envSabre;
const sessionHistory: HistoryTurn[] = [];

printHelp(useV2 ? "V2" : "V1", true);

const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout,
	terminal: true,
});

while (true) {
	const query = await rl.question(term.prompt());
	const trimmed = query.trim();

	if (!trimmed) continue;
	if (trimmed === "exit" || trimmed === "quit") {
		term.bye();
		break;
	}

	if (trimmed === "/help") {
		printHelp(useV2 ? "V2" : "V1", true);
		continue;
	}

	if (trimmed === "/clear") {
		sessionHistory.length = 0;
		term.write(`  ${term.c("gray", "Session cleared.")}`);
		term.write();
		continue;
	}

	if (trimmed === "/history") {
		if (sessionHistory.length === 0) {
			term.write(`  ${term.c("gray", "(empty session)")}`);
		} else {
			for (const turn of sessionHistory) {
				term.write(
					`  ${term.c("gray", `"${turn.query}"`)} ${term.c("brightCyan", "→")} ${term.c("brightGreen", turn.command)}`,
				);
			}
		}
		term.write();
		continue;
	}

	try {
		const result = await loading.run("Processing", () =>
			translate(
				trimmed,
				interactiveDebug,
				useV2,
				useV2 ? sessionHistory : undefined,
			),
		);

		if (!result) {
			term.write();
			continue;
		}

		if (interactiveDebug) {
			await presentPipeline(trimmed, result, interactiveSabre);
		} else {
			term.write(
				`  ${term.c("brightGreen", "=>")} ${term.c("bold", term.c("brightGreen", result.command))}`,
			);
			term.write();
			if (interactiveSabre && !isRefusal(result.command)) {
				await runSabreQuiet(result.command);
			}
		}

		if (useV2 && !isRefusal(result.command)) {
			sessionHistory.push({ query: trimmed, command: result.command });
			if (sessionHistory.length > 10) {
				sessionHistory.splice(0, sessionHistory.length - 10);
			}
		}

		term.write();
	} catch (err) {
		step.error(
			`Connection error: ${err instanceof Error ? err.message : String(err)}`,
		);
		step.dim("Check ASSISTANT_API_URL or run assistant locally.");
		term.write();
	}
}

rl.close();
