import { loadConfig, log } from "core";
import { translateQuery } from "./translate-query.ts";

const config = loadConfig();

const server = Bun.serve({
	port: Number(process.env.PORT ?? 3000),
	async fetch(req) {
		const url = new URL(req.url);

		if (req.method === "POST" && url.pathname === "/translate") {
			try {
				const body = (await req.json()) as { query?: string };
				if (!body.query) {
					return Response.json(
						{ error: "Missing 'query' in request body" },
						{ status: 400 },
					);
				}

				const { command, truncated } = await translateQuery(
					body.query,
					config,
				);
				return Response.json({ query: body.query, command, truncated });
			} catch (err) {
				log.error("Request failed:", err);
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
