import {
	BedrockRuntimeClient,
	InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { log } from "./logger.ts";

export class EmbeddingService {
	private client: BedrockRuntimeClient;
	private modelId: string;
	private dimensions: number;

	constructor(region: string, modelId: string, dimensions: number) {
		this.client = new BedrockRuntimeClient({ region });
		this.modelId = modelId;
		this.dimensions = dimensions;
	}

	async embed(text: string): Promise<number[]> {
		const payload = JSON.stringify({
			inputText: text,
			dimensions: this.dimensions,
		});

		const command = new InvokeModelCommand({
			modelId: this.modelId,
			body: payload,
			contentType: "application/json",
			accept: "application/json",
		});

		const response = await this.client.send(command);
		const body = JSON.parse(new TextDecoder().decode(response.body)) as {
			embedding: number[];
		};

		return body.embedding;
	}

	async embedBatch(texts: string[], batchSize = 20): Promise<number[][]> {
		const results: number[][] = [];

		for (let i = 0; i < texts.length; i += batchSize) {
			const batch = texts.slice(i, i + batchSize);
			log.info(`Embedding batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(texts.length / batchSize)} (${batch.length} texts)`);

			const embeddings = await Promise.all(batch.map((t) => this.embed(t)));
			results.push(...embeddings);

			if (i + batchSize < texts.length) {
				await new Promise((r) => setTimeout(r, 500));
			}
		}

		return results;
	}
}
