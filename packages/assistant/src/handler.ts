import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { loadConfig, log } from "core";
import { matchAssistantRoute } from "./api-routes.ts";
import { loadIntentCentroids } from "./load-intent-centroids.ts";
import { translateQuery } from "./translate-query.ts";
import { translateQueryV2 } from "./v2/translate-query-v2.ts";

const config = loadConfig();
const intentCentroids = loadIntentCentroids();

function jsonResponse(
	statusCode: number,
	body: Record<string, unknown>,
): APIGatewayProxyResult {
	return {
		statusCode,
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	};
}

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

function embeddingStatusCode(message: string): number {
	return message.startsWith("Embedding failed:") ? 502 : 500;
}

async function handleV1(
	event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
	const body = JSON.parse(event.body ?? "{}") as { query?: string };

	if (!body.query || typeof body.query !== "string") {
		return jsonResponse(400, { error: "Missing 'query' in request body" });
	}

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

	return jsonResponse(200, payload);
}

async function handleV2(
	event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
	const body = JSON.parse(event.body ?? "{}") as {
		query?: string;
		session_id?: string;
		history?: Array<{ query: string; command: string }>;
	};

	if (!body.query || typeof body.query !== "string") {
		return jsonResponse(400, { error: "Missing 'query' in request body" });
	}

	const debug = wantsDebug(event);
	const { command, truncated, debug: debugInfo } = await translateQueryV2(
		body.query,
		config,
		intentCentroids,
		{
			debug,
			sessionId: body.session_id,
			history: body.history,
		},
	);

	const payload: Record<string, unknown> = {
		query: body.query,
		command,
		truncated,
	};
	if (body.session_id) payload.session_id = body.session_id;
	if (debugInfo) payload.debug = debugInfo;

	return jsonResponse(200, payload);
}

export async function handler(
	event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
	const route = matchAssistantRoute(event);

	if (route === "health") {
		return jsonResponse(200, { status: "ok" });
	}

	if (route === null) {
		return jsonResponse(404, { error: "Not found" });
	}

	try {
		if (route === "v2") return await handleV2(event);
		return await handleV1(event);
	} catch (err) {
		log.error(`Translation failed (${route}):`, err);
		const message = err instanceof Error ? err.message : String(err);
		return jsonResponse(embeddingStatusCode(message), { error: message });
	}
}
