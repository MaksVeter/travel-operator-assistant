import type { APIGatewayProxyEvent } from "aws-lambda";

export type AssistantRoute = "health" | "v1" | "v2";

export function matchAssistantRoute(
	event: APIGatewayProxyEvent,
): AssistantRoute | null {
	const method = event.httpMethod?.toUpperCase() ?? "";
	const resource = event.resource ?? "";
	const path = event.path ?? "";

	if (method === "GET" && (resource === "/health" || path.endsWith("/health"))) {
		return "health";
	}

	if (
		method === "POST" &&
		(resource === "/v2/translate" || path.endsWith("/v2/translate"))
	) {
		return "v2";
	}

	if (method === "POST" && (resource === "/translate" || path.endsWith("/translate"))) {
		return "v1";
	}

	return null;
}
