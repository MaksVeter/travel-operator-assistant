import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { loadConfig, log } from "core";
import { translateQuery } from "./translate-query.ts";

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
		const command = await translateQuery(body.query, config);

		return {
			statusCode: 200,
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ query: body.query, command }),
		};
	} catch (err) {
		log.error("Translation failed:", err);
		return {
			statusCode: 500,
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				error: err instanceof Error ? err.message : String(err),
			}),
		};
	}
}
