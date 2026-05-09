import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { loadSabreConfig } from "./config.ts";
import { log } from "./log.ts";
import { runSabreHostCommand, validateSabreHostCommand } from "./sabre-soap.ts";

export async function handler(
	event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
	const method = event.httpMethod;
	const resource = event.resource ?? "";

	if (method === "GET" && resource === "/health") {
		return {
			statusCode: 200,
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ status: "ok", service: "sabre-command" }),
		};
	}

	if (method !== "POST") {
		return {
			statusCode: 404,
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				error: "Use POST /command, POST /validate, or GET /health",
			}),
		};
	}

	try {
		const body = JSON.parse(event.body ?? "{}") as {
			command?: string;
			includeRawXml?: boolean;
			dryRun?: boolean;
		};

		if (!body.command || typeof body.command !== "string") {
			return {
				statusCode: 400,
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ error: "Missing 'command' in request body" }),
			};
		}

		const cfg = loadSabreConfig();

		if (resource === "/validate") {
			const v = await validateSabreHostCommand(cfg, body.command);
			return {
				statusCode: 200,
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					command: body.command,
					valid: v.valid,
					mode: "validate",
					...(v.screen !== undefined ? { screen: v.screen } : {}),
					...(v.error ? { error: v.error } : {}),
				}),
			};
		}

		if (resource !== "/command") {
			return {
				statusCode: 404,
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ error: "Unknown path" }),
			};
		}

		const result = await runSabreHostCommand(cfg, body.command, {
			discardTransaction: body.dryRun === true,
		});

		return {
			statusCode: 200,
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				command: body.command,
				mode: body.dryRun === true ? "command+dryRun" : "command",
				screen: result.screen ?? null,
				discardedTransaction: result.discardedTransaction === true,
				...(body.includeRawXml ? { rawXml: result.rawXml } : {}),
			}),
		};
	} catch (err) {
		log.error("Sabre command failed:", err);
		const message = err instanceof Error ? err.message : String(err);
		return {
			statusCode: 502,
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ error: message }),
		};
	}
}
