import { Client } from "@opensearch-project/opensearch";
import { AwsSigv4Signer } from "@opensearch-project/opensearch/aws";
import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { log } from "./logger.ts";
import type { SearchHit } from "./types.ts";

export class SearchClient {
	private client: Client;

	constructor(endpoint: string, region: string) {
		this.client = new Client({
			...AwsSigv4Signer({
				region,
				service: "aoss",
				getCredentials: () => defaultProvider()(),
			}),
			node: endpoint,
		});
	}

	async indexExists(name: string): Promise<boolean> {
		try {
			const resp = await this.client.indices.exists({ index: name });
			return resp.body as boolean;
		} catch {
			return false;
		}
	}

	async createIndex(
		name: string,
		mapping: Record<string, unknown>,
	): Promise<void> {
		log.info(`Creating index: ${name}`);
		await this.client.indices.create({ index: name, body: mapping });
		log.info(`Index created: ${name}`);
	}

	async deleteIndex(name: string): Promise<void> {
		log.warn(`Deleting index: ${name}`);
		await this.client.indices.delete({ index: name });
		log.info(`Index deleted: ${name}`);
	}

	async bulkIndex(
		indexName: string,
		documents: Record<string, unknown>[],
	): Promise<{ successful: number; failed: number }> {
		if (documents.length === 0) return { successful: 0, failed: 0 };

		const body = documents.flatMap((doc, i) => [
			{ index: { _index: indexName } },
			doc,
		]);

		const resp = await this.client.bulk({ body });
		const items = resp.body.items as Array<{
			index?: { error?: unknown; result?: string };
		}>;

		let successful = 0;
		let failed = 0;
		for (const item of items) {
			if (item.index?.error) {
				log.error("Bulk index error:", item.index.error);
				failed++;
			} else {
				successful++;
			}
		}

		return { successful, failed };
	}

	async knnSearch<T = Record<string, unknown>>(
		indexName: string,
		vector: number[],
		topK: number,
	): Promise<SearchHit<T>[]> {
		const resp = await this.client.search({
			index: indexName,
			body: {
				size: topK,
				query: {
					knn: {
						embedding: {
							vector,
							k: topK,
						},
					},
				},
			},
		});

		const hits = resp.body.hits?.hits ?? [];
		return (
			hits as Array<{ _score: number; _source: T }>
		).map((h) => ({
			score: h._score,
			source: h._source,
		}));
	}

	async keywordSearch<T = Record<string, unknown>>(
		indexName: string,
		queryText: string,
		topK: number,
	): Promise<SearchHit<T>[]> {
		const resp = await this.client.search({
			index: indexName,
			body: {
				size: topK,
				query: {
					multi_match: {
						query: queryText,
						fields: [
							"description^2",
							"synonyms",
							"text_for_embedding",
						],
						type: "best_fields",
					},
				},
			},
		});

		const hits = resp.body.hits?.hits ?? [];
		return (
			hits as Array<{ _score: number; _source: T }>
		).map((h) => ({
			score: h._score,
			source: h._source,
		}));
	}

	async intentSearch<T = Record<string, unknown>>(
		indexName: string,
		intent: string,
	): Promise<SearchHit<T> | null> {
		const resp = await this.client.search({
			index: indexName,
			body: {
				size: 1,
				query: { term: { intent } },
			},
		});

		const hit = (resp.body.hits?.hits ?? [])[0] as
			| { _score: number; _source: T }
			| undefined;
		if (!hit) return null;

		return { score: hit._score, source: hit._source };
	}
}
