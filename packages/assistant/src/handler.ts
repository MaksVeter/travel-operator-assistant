import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { loadConfig, log } from "core";
import { translateQuery } from "./translate-query.ts";

function wantsDebug(event: APIGatewayProxyEvent): boolean {
	const env = process.env.ASSISTANT_DEBUG?.toLowerCase();
	if (env === "1" || env === "true") return true;
	const h = event.headers ?? {};
	const v =
		h["X-Assistant-Debug"] ??
		h["x-assistant-debug"] ??
		h["X-assistant-debug"];
	if (v === undefined || v === null) return false;
	const s = String(v).toLowerCase();
	return s === "1" || s === "true" || s === "yes";
}

export async function handler(
	event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
	try {
		const body = JSON.parse(event.body ?? "{}") as { query?: string };

		if (!body.query || typeof body.query !== "string") {
			return {
				statusCode: 400,
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ error: "Missing 'query' in request body" }),
			};
		}

		const config = loadConfig();
		const debug = wantsDebug(event);
		const { command, truncated, debug: debugSteps } = await translateQuery(
			body.query,
			config,
			{ debug },
		);

		const payload: Record<string, unknown> = {
			query: body.query,
			command,
			truncated,
		};
		if (debugSteps?.length) payload.debug = debugSteps;

		return {
			statusCode: 200,
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		};
	} catch (err) {
		log.error("Translation failed:", err);
		const message = err instanceof Error ? err.message : String(err);
		const isEmbedding =
			typeof message === "string" && message.startsWith("Embedding failed:");
		return {
			statusCode: isEmbedding ? 502 : 500,
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ error: message }),
		};
	}
}
