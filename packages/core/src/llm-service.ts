import {
	BedrockRuntimeClient,
	InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";

export class LlmService {
	private client: BedrockRuntimeClient;
	private modelId: string;

	constructor(region: string, modelId: string) {
		this.client = new BedrockRuntimeClient({ region });
		this.modelId = modelId;
	}

	async complete(prompt: string): Promise<string> {
		const payload = JSON.stringify({
			anthropic_version: "bedrock-2023-05-31",
			max_tokens: 256,
			messages: [{ role: "user", content: prompt }],
			temperature: 0,
		});

		const command = new InvokeModelCommand({
			modelId: this.modelId,
			body: payload,
			contentType: "application/json",
			accept: "application/json",
		});

		const response = await this.client.send(command);
		const body = JSON.parse(new TextDecoder().decode(response.body)) as {
			content: Array<{ type: string; text: string }>;
		};

		const textBlock = body.content.find((c) => c.type === "text");
		return textBlock?.text?.trim() ?? "";
	}
}
