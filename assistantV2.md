# Assistant V2 — Architecture & Pipeline

## Overview

Version 2 of the Travel Operator Assistant improves translation quality through a multi-stage pipeline with query preprocessing, hybrid retrieval, intent classification, and DSL-aware validation. V1 remains untouched and fully operational alongside V2.

Key improvements over V1:
- LLM-based query rewrite before search (removes noise, preserves parameters)
- Hybrid retrieval combining semantic (kNN) and keyword (BM25) search with Reciprocal Rank Fusion
- Intent classification using precomputed embedding centroids
- Structured prompt with separate system message and few-shot examples
- Post-generation DSL validation with optional retry
- Client-side session support (multi-turn conversations, stateless API)
- Full observability in debug mode

---

## Pipeline Steps

```
User query
  → 1. Truncate (token budget)
  → 2. Query Rewrite (LLM)
  → 3. Embed rewritten query (Bedrock Titan)
  → 4. Parallel search: kNN + BM25 keyword
  → 5. Merge results (Reciprocal Rank Fusion)
  → 6. Classify intent (cosine similarity to centroids)
  → 7. Filter context (dedup, limit, optional intent boost)
  → 8. Assemble prompt (system + user with reference catalog)
  → 9. Generate command (LLM with DSL constraints)
  → 10. Validate & normalize output
  → Sabre command OR refusal
```

---

## Step Details

### 1. Query Rewrite

A fast LLM call (Claude Haiku, temperature=0) rewrites the raw user input into a clean search-optimized query. Conversational noise is removed while all concrete parameters (cities, dates, codes, numbers) are preserved.

**Example:**
- Input: "Hey sorry, client is on the phone. Can you check city code for Paris please?"
- Output: "city code Paris"

The rewritten query is used for embedding and keyword search. The original query is passed to the final generation step so no details are lost.

### 2–5. Hybrid Retrieval

Two independent searches run in parallel against the OpenSearch index:
- **kNN** (semantic): embedding similarity, captures intent even with paraphrases
- **BM25** (keyword): exact term matching on description, synonyms, embedding text

Results are merged using **Reciprocal Rank Fusion (RRF)** which normalizes the different score scales and combines rankings. This avoids issues with incompatible score distributions between kNN and BM25.

Top-6 results are retrieved before filtering.

### 6. Intent Classification

Each of the 40 knowledge base intents has a precomputed embedding centroid. At query time, the query embedding is compared to all centroids via cosine similarity. Top-3 predicted intents with confidence scores are produced.

This runs in-memory (<1ms) with no network calls.

### 7. Context Filtering

Retrieved chunks are filtered down to the most relevant 3:
- Deduplication by intent (keep best per intent)
- Intent boost: if confidence exceeds threshold (0.6), matching chunks get 1.5x score boost
- When confidence is low, no boost is applied — retrieval ranking is trusted as-is

### 8. Prompt Construction

V2 uses a separate system prompt (via Bedrock Messages API `system` field) for role/format constraints. The user message contains:
- Reference catalog with description, format, example, signature, synonyms, sample queries
- Optional DSL hint when intent prediction is confident
- The original user request

### 9–10. Generation & Validation

The LLM generates a single command. Post-processing:
- Strips markdown artifacts (backticks, quotes)
- Detects refusals
- Validates command structure against DSL regex patterns
- If validation fails with high-confidence intent, one retry with explicit signature constraint

---

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `V2_RETRIEVAL_TOP_K` | 6 | Chunks to retrieve from OpenSearch |
| `V2_CONTEXT_LIMIT` | 3 | Chunks to include in prompt |
| `V2_SCORE_THRESHOLD` | 0 | Min retrieval score (0 = disabled for RRF) |
| `V2_INTENT_CONFIDENCE_THRESHOLD` | 0.6 | Min confidence for intent boost |
| `V2_ENABLE_RETRY` | true | Retry on DSL validation failure |

---

## API

**Endpoint:** `POST /v2/translate`

**Request:**
```json
{
  "query": "add 3 days",
  "history": [
    { "query": "find flights from DEL to JFK on March 10", "command": "110MARDELJFK" }
  ]
}
```

**Response:**
```json
{ "query": "add 3 days", "command": "1‡3", "truncated": false }
```

**Session support (client-side):** Pass `history` array (previous turns) in the request body to enable multi-turn context. The server is stateless — session management lives entirely on the client. This makes the API compatible with Lambda, containers, and any stateless backend.

Alternatively, `session_id` is still accepted for backward compatibility with server-side in-memory storage (suitable for local development only).

**Debug mode** (header `X-Assistant-Debug: 1`):
Returns additional `debug` field with rewritten query, retrieved chunks, predicted intents, final prompt, raw LLM output, validation status, and per-step latency.

---

## Running Locally

```bash
# 1. Generate intent centroids (one-time, requires Bedrock access)
bun run precompute:intent-centroids

# 2. Start server (serves both V1 and V2)
bun run assistant:local

# 3. Test V2 via curl
curl -X POST http://localhost:3000/v2/translate \
  -H "Content-Type: application/json" \
  -d '{"query": "what is the airline code for SAS"}'

# 4. Interactive CLI with session support
bun run cli:v2
```

---

## File Structure

```
packages/assistant/src/v2/
  translate-query-v2.ts   — pipeline orchestrator
  rewrite-query.ts        — LLM query rewrite (session-aware)
  hybrid-search.ts        — dual kNN+BM25 search with RRF merge
  classify-intent.ts      — embedding-based intent classification
  filter-context.ts       — context reduction and ranking
  assemble-prompt-v2.ts   — structured prompt assembly (session-aware)
  validate-command.ts     — output validation and normalization
  dsl-patterns.ts         — regex patterns for all Sabre commands
  session.ts              — server-side session store (fallback for local dev)
  types.ts                — V2 type definitions

packages/cli/src/
  main.ts                 — CLI with V2 session support, /clear, /history

data/
  intent-centroids.json   — precomputed intent embeddings
```

---

## Session Support (Client-Side)

V2 supports multi-turn conversations via **client-side session history**. The API server is stateless — history is passed by the client in each request.

**How it works:**
1. Client collects successful (query → command) pairs locally
2. Client sends the `history` array with each new request
3. Server uses history for context-aware query rewrite and generation
4. Client appends the new result to its local history

**Pipeline usage of history:**
- **Query rewrite:** LLM resolves pronouns and references ("add more days", "change it to SFO") using prior turns
- **Prompt construction:** Previous commands are included as context for the LLM generator

**Client constraints:**
- Keep last 10 turns maximum (older turns are dropped)
- Only store non-refusal commands
- Clear history on user request (`/clear` command in CLI)

**Example multi-turn conversation:**
```
Turn 1: "find flights from DEL to JFK on March 10"  → 110MARDELJFK
Turn 2: "add 3 days"                                 → 1‡3
Turn 3: "change destination to LAX"                  → 1*ALAX
```

Without `history`, each request is independent (stateless mode).

### CLI Session Commands

| Command | Description |
|---------|-------------|
| `/clear` | Clear session history |
| `/history` | Show current session turns |
| `--v2` | Launch CLI in V2 mode with session support |

---

## V1 vs V2 Comparison

| Aspect | V1 | V2 |
|--------|----|----|
| Query preprocessing | None | LLM rewrite |
| Retrieval | kNN only, top-3 | kNN + BM25, RRF merge, top-6 |
| Intent awareness | None | Centroid-based classification |
| Context filtering | None | Score + dedup + intent boost |
| Prompt | Single user message | System + user, few-shot, DSL hints |
| Validation | None | Regex patterns + retry |
| Session support | None | Optional multi-turn with context |
| Observability | Step labels only | Full debug with latency breakdown |
| LLM calls per request | 1 | 2 (rewrite + generate) |
