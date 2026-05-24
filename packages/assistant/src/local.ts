import fs from "node:fs";
import path from "node:path";
import { loadConfig, log } from "core";
import { translateQuery } from "./translate-query.ts";
import { translateQueryV2 } from "./v2/translate-query-v2.ts";
import type { IntentCentroid } from "./v2/types.ts";

const config = loadConfig();

// Load intent centroids for V2 (if available)
let intentCentroids: IntentCentroid[] = [];
const centroidsPath = path.join(process.cwd(), "data", "intent-centroids.json");
if (fs.existsSync(centroidsPath)) {
	intentCentroids = JSON.parse(
		fs.readFileSync(centroidsPath, "utf8"),
	) as IntentCentroid[];
	log.info(`Loaded ${intentCentroids.length} intent centroids for V2`);
} else {
	log.warn(
		`Intent centroids not found at ${centroidsPath} — V2 intent classification disabled`,
	);
}

function isDebugRequest(req: Request): boolean {
	return (
		req.headers.get("X-Assistant-Debug")?.toLowerCase() === "1" ||
		req.headers.get("X-Assistant-Debug")?.toLowerCase() === "true" ||
		process.env.ASSISTANT_DEBUG === "1" ||
		process.env.ASSISTANT_DEBUG === "true"
	);
}

const server = Bun.serve({
	port: Number(process.env.PORT ?? 3000),
	async fetch(req) {
		const url = new URL(req.url);

		// V1 endpoint
		if (req.method === "POST" && url.pathname === "/translate") {
			try {
				const body = (await req.json()) as { query?: string };
				if (!body.query) {
					return Response.json(
						{ error: "Missing 'query' in request body" },
						{ status: 400 },
					);
				}

				const dbg = isDebugRequest(req);

				const { command, truncated, debug } = await translateQuery(
					body.query,
					config,
					{ debug: dbg },
				);
				const payload: Record<string, unknown> = {
					query: body.query,
					command,
					truncated,
				};
				if (debug?.length) payload.debug = debug;
				return Response.json(payload);
			} catch (err) {
				log.error("V1 request failed:", err);
				const message = err instanceof Error ? err.message : String(err);
				const isEmbedding =
					typeof message === "string" &&
					message.startsWith("Embedding failed:");
				return Response.json(
					{ error: message },
					{ status: isEmbedding ? 502 : 500 },
				);
			}
		}

		// V2 endpoint
		if (req.method === "POST" && url.pathname === "/v2/translate") {
			try {
				const body = (await req.json()) as {
					query?: string;
					session_id?: string;
					history?: Array<{ query: string; command: string }>;
				};
				if (!body.query) {
					return Response.json(
						{ error: "Missing 'query' in request body" },
						{ status: 400 },
					);
				}

				const dbg = isDebugRequest(req);

				const { command, truncated, debug } = await translateQueryV2(
					body.query,
					config,
					intentCentroids,
					{
						debug: dbg,
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
				if (debug) payload.debug = debug;
				return Response.json(payload);
			} catch (err) {
				log.error("V2 request failed:", err);
				const message = err instanceof Error ? err.message : String(err);
				const isEmbedding =
					typeof message === "string" &&
					message.startsWith("Embedding failed:");
				return Response.json(
					{ error: message },
					{ status: isEmbedding ? 502 : 500 },
				);
			}
		}

		if (req.method === "GET" && url.pathname === "/health") {
			return Response.json({ status: "ok" });
		}

		return Response.json({ error: "Not found" }, { status: 404 });
	},
});

log.info(`Assistant server listening on http://localhost:${server.port}`);
log.info("Endpoints: POST /translate (V1), POST /v2/translate (V2), GET /health");
