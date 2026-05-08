export type DslChunk = {
	intent: string;
	type: string;
	description: string;
	format: string;
	example: string;
	synonyms: string[];
	text_for_embedding: string;
	category: string;
	user_queries: string[];
	priority: string;
	dsl_signature: string;
};

export type IndexedChunk = DslChunk & {
	embedding: number[];
};

export type SearchHit<T = Record<string, unknown>> = {
	score: number;
	source: T;
};

export type ScoredChunk = SearchHit<DslChunk>;
