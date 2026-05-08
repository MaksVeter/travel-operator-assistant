export function buildIndexMapping(dimensions: number): Record<string, unknown> {
	return {
		settings: {
			"index.knn": true,
			number_of_shards: 1,
			number_of_replicas: 0,
		},
		mappings: {
			properties: {
				intent: { type: "keyword" },
				command_type: { type: "keyword" },
				category: { type: "keyword" },
				description: { type: "text" },
				format: { type: "text", index: false },
				example: { type: "text", index: false },
				dsl_signature: { type: "keyword" },
				synonyms: { type: "text" },
				text_for_embedding: { type: "text" },
				user_queries: { type: "text" },
				priority: { type: "keyword" },
				embedding: {
					type: "knn_vector",
					dimension: dimensions,
					method: {
						name: "hnsw",
						space_type: "cosinesimil",
						engine: "nmslib",
					},
				},
			},
		},
	};
}
