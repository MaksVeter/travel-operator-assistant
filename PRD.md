# Travel Operator Assistant — Product Requirements Document

## 1. Overview

**Travel Operator Assistant** is an AI-powered system that translates natural language queries into strict domain-specific DSL commands compatible with the Sabre GDS (Global Distribution System) terminal syntax.

Travel agents and operators interact with legacy GDS terminals using cryptic command strings. This system eliminates the need to memorize complex syntax by allowing operators to describe what they want in plain English and receive the exact Sabre command in response.

### Example

| Input (natural language) | Output (Sabre DSL) |
|---|---|
| "find flights from FRA to DUB on Dec 13 at 11am" | `113DECFRADUB11A` |
| "what is the city code for knoxville" | `W/-CCKNOXVILLE` |
| "show availability for lufthansa from JFK to LHR on march 5" | `105MARJFKLHR*LH` |

When the request is unclear, off-topic, or cannot be mapped to the knowledge base, the API may return a **short refusal message in English** (including example phrasings) instead of a DSL line. The MVP still exposes that text in the same `command` field for simplicity.

---

## 2. Problem Statement

Sabre GDS commands follow an extremely rigid syntax where the position, order, and format of every character matters. A single misplaced character produces an error or wrong results. Travel operators must memorize dozens of command patterns across encoding, decoding, availability, and booking categories.

**Current pain points:**
- Steep learning curve for new operators
- High error rates due to syntax sensitivity
- No autocomplete or natural language support in legacy terminals
- Productivity loss from looking up command references

---

## 3. Solution

A Retrieval-Augmented Generation (RAG) pipeline that:

1. Accepts a natural language query from the user (**English only**; each request is treated as **standalone** — no chat history)
2. **Truncates** the query to a configurable approximate token budget (default ~4000 tokens) before embedding
3. Finds the most relevant DSL command patterns from a curated knowledge base using semantic vector search
4. Constructs a precise prompt with matched command descriptions, **full example commands only** (no placeholder templates in the catalog section), and strict output rules
5. Invokes a large language model (**Amazon Bedrock**) to produce either a **single-line Sabre command** or a **refusal** with example requests
6. Returns JSON including **`truncated`** when the query was trimmed

The system is designed as an **MVP** — a single-step pipeline with no validation, no retries, no session memory, and no agent architecture. It prioritizes simplicity and correctness over sophistication.

---

## 4. Knowledge Base

The knowledge base consists of **40 pre-chunked DSL command definitions** stored in `chunks.json`. Each chunk is a self-contained command reference:

| Field | Description |
|---|---|
| `intent` | Semantic identifier (e.g., `encode_city`, `basic_availability`) |
| `type` | `command` or `interpretation` |
| `category` | `encoding` (12), `availability` (22), `decoding` (3), `interpretation` (3) |
| `description` | Human-readable explanation |
| `format` | Exact syntax pattern with placeholders (used in data; **not** shown as a partial template in the LLM catalog block) |
| `example` | Concrete **complete** command example |
| `dsl_signature` | Command prefix (e.g., `W/-CC`, `VA*`, `1`) |
| `synonyms` | Alternative phrasings for search |
| `text_for_embedding` | Optimized text for vector embedding generation |
| `user_queries` | Sample natural language queries (embedding / data only; refusal examples in the prompt use a **fixed standalone list**) |
| `priority` | `high` / `medium` / `low` |

Chunking is already complete. No further preprocessing is needed.

---

## 5. Architecture

### 5.1 High-Level Flow

```
User Query (English, single turn)
        |
        v
  [Truncate to max query tokens]  -- env: MAX_QUERY_TOKENS (default 4000, heuristic ~4 chars/token)
        |
        v
  [Embedding Service]  -- Amazon Bedrock (e.g. Titan Embed Text v2)
        |
        v
  [Vector Search]      -- OpenSearch Serverless kNN
        |
        v
  [Prompt Assembly]    -- top-k chunks + rules (full commands only) + query
        |
        v
  [LLM Generation]    -- Amazon Bedrock Claude (see model / inference profile below)
        |
        v
  DSL command (string) OR refusal text (string)  +  truncated flag
```

### 5.2 Components

| Component | Technology | Purpose |
|---|---|---|
| **Embedding** | Amazon Bedrock, Titan Embed Text v2 (1024 dim) | Convert text to vector representations |
| **Vector Store** | Amazon OpenSearch Serverless (VECTORSEARCH) | Store and search command embeddings via kNN |
| **LLM** | Amazon Bedrock, Claude (configurable; **inference profile** IDs such as `eu.anthropic...` where required) | Generate DSL command or refusal from prompt |
| **Indexer** | AWS Lambda (Node.js 20) | Embed chunks and load into OpenSearch (manual invoke) |
| **Assistant API** | AWS Lambda + API Gateway | Serve translation requests |
| **CLI** | Bun script | Interactive or one-shot HTTP client (`ASSISTANT_API_URL` or local server) |
| **Infrastructure** | AWS CDK (TypeScript), app run via **Bun**; local bundling uses **esbuild** (no Docker required for synth) | Define and deploy all AWS resources |

### 5.3 Indexing Pipeline

```
chunks.json
    |
    v
[Load 40 chunks] -> [Batch embed via Bedrock] -> [Create index] -> [Bulk index documents]
```

- Runs as a Lambda function or locally via `bun run indexer:local`
- **OpenSearch Serverless**: bulk indexing does **not** set document `_id` (IDs are assigned by the service)
- Index deletion is guarded by the `FORCE_RECREATE_INDEX` environment variable (default: `false`)
- Safe to re-invoke without data loss unless explicitly requested

### 5.4 Query Pipeline

```
POST /translate { "query": "..." }
    |
    v
[Truncate] -> [Embed query] -> [kNN search, top-k] -> [Assemble prompt] -> [Bedrock LLM]
    |
    v
{ "query": "...", "command": "...", "truncated": boolean }
```

- Single LLM call, no retries, no validation
- Prompt states **no prior conversation**; catalog shows **description + reference full command + dsl_signature**, not `format` placeholders
- On **embedding failure**, API returns **502** with `error` message prefix `Embedding failed:`; other errors typically **500**

---

## 6. AWS Infrastructure

Primary region in this project: **eu-north-1** (configurable). Deploy with AWS CDK as **three stacks** in order:

1. **TravelAssistantOpenSearch** — collection, encryption, network, **data access** policy  
2. **TravelAssistantIndexer** — depends on OpenSearch  
3. **TravelAssistantApi** — depends on OpenSearch  

Indexer and API stacks may be deployed in parallel after OpenSearch.

### 6.1 OpenSearch Serverless Stack

- AOSS Collection (type: `VECTORSEARCH`)
- Encryption policy (AWS-owned key)
- Network policy (public access)
- Data access policy: Lambda indexer + assistant **roles**, plus optional **extra principals** from env at synth/deploy time:
  - `OPENSEARCH_EXTRA_PRINCIPAL_ARNS` — comma-separated IAM ARNs (e.g. developer user, `arn:aws:iam::ACCOUNT:root`) for local tools / CLI indexing

### 6.2 Indexer Stack

- Lambda function (Node.js 20, 512 MB, 5 min timeout)
- IAM: `aoss:APIAccessAll` on collection + `bedrock:InvokeModel` on foundation models
- Entry: `packages/indexer/src/handler.ts`; **no** scheduled trigger — **manual** `aws lambda invoke`
- Bundling copies `chunks.json` into the asset; **esbuild** in `packages/infra` for local synth

### 6.3 Assistant API Stack

- Lambda function (Node.js 20, 512 MB, 30 sec timeout)
- API Gateway REST API: `POST /translate`, `GET /health`
- IAM:
  - `aoss:APIAccessAll` on collection ARN
  - `bedrock:InvokeModel`, `bedrock:GetInferenceProfile` on `foundation-model/*` and `inference-profile/*` (for cross-region / profile-based Claude)
  - **`aws-marketplace:Subscribe`**, **`Unsubscribe`**, **`ViewSubscriptions`** on `*` — required for first-time Marketplace-backed model enablement in the account (per AWS Bedrock model access docs)
- Environment includes `OPENSEARCH_*`, `EMBEDDING_*`, `LLM_*`, `MAX_QUERY_TOKENS`, etc.
- **CloudWatch**: explicit **LogGroup** per function (no deprecated `logRetention` on Lambda options)

### 6.4 Bootstrap and local CDK

- One-time: `cdk bootstrap aws://ACCOUNT/REGION`
- Root `package.json` scripts proxy to `packages/infra` (`cdk:ls`, `cdk:deploy`, etc.)
- `cdk.json` app entry uses **Bun**; ensure `bun` is on `PATH` when running CDK
- Env for CDK-only vars (e.g. `OPENSEARCH_EXTRA_PRINCIPAL_ARNS`) must be present **during** `cdk deploy` if templates should include them; root **`bun run env:sync`** copies `.env` into each `packages/*` for that purpose

---

## 7. Project Structure

```
travel-operator-assistant/
  scripts/
    sync-env-to-packages.sh   # copy root .env -> packages/*/.env
  packages/
    core/           Shared: embedding, search, LLM, config, query limits, types
    indexer/        Indexing: Lambda handler, local.ts, opensearch smoke check
    assistant/      RAG: handler, local server, translate-query, assemble-prompt
    cli/            HTTP client (ASSISTANT_API_URL / ASSISTANT_URL)
    infra/          CDK stacks (OpenSearch, Indexer, Assistant API)
```

Bun monorepo with workspace dependencies. TypeScript throughout.

---

## 8. Functional Requirements

### FR-1: Natural Language to DSL Translation
- System accepts an **English** natural language query and returns a Sabre GDS command **or** a refusal message per prompt rules
- When returning a command, it must be a **complete** line (no templates with unfilled placeholders)
- Prefer **no** extra markdown; success case is ideally a single DSL line in `command`

### FR-2: Semantic Retrieval
- User query is embedded with the same family of models as indexing (Bedrock)
- Top-k (default: **3**, `RETRIEVAL_TOP_K`) retrieved via kNN
- Retrieved chunks feed the prompt catalog section

### FR-3: Knowledge Base Indexing
- All 40 chunks from `chunks.json` are embedded and stored in OpenSearch
- Index supports kNN vector search
- Re-indexing: index recreated only when `FORCE_RECREATE_INDEX=true`

### FR-4: API Endpoint
- `POST /translate` accepts `{ "query": string }` and returns `{ "query": string, "command": string, "truncated": boolean }`
- `GET /health` returns `{ "status": "ok" }`
- Errors: `{ "error": string }` — **502** when embedding fails (`Embedding failed:`), other failures typically **500**

### FR-5: Local Development
- Indexer: `bun run indexer:local` (requires OpenSearch data access for caller identity)
- Assistant: `bun run assistant:local` (HTTP on `PORT`, default 3000)
- OpenSearch smoke test: `bun run opensearch:check-index` (creates/deletes a temporary index)
- CLI: `bun run cli` (REPL) or `bun run cli -- "your query"` (one-shot); set **`ASSISTANT_API_URL`** to the API Gateway base URL (with stage, no trailing slash)
- **`bun run env:sync`** — align `.env` across packages after editing root `.env`

---

## 9. Non-Functional Requirements

### NFR-1: Latency
- Target: < 5 seconds end-to-end for a typical translation request
- Embedding, kNN, and LLM dominate; exact numbers depend on region and model

### NFR-2: Cost
- Embedding and LLM: **Amazon Bedrock** pay-per-use (see current [Bedrock pricing](https://aws.amazon.com/bedrock/pricing)); Claude **Haiku-class** and **GPT-5.x** class models differ — use official pricing pages for estimates
- OpenSearch Serverless: OCU-based billing
- MVP: keep usage low via Haiku / small prompts where possible

### NFR-3: Security
- IAM for AWS services; SigV4 for OpenSearch Serverless
- Lambda execution roles scoped to collection + Bedrock + Marketplace actions as needed
- Secrets: no API keys in repo; `.env` gitignored

### NFR-4: Observability
- Structured logging; CloudWatch Logs via explicit log groups
- API Gateway metrics and logs as configured in CDK

---

## 10. Environment Variables (summary)

| Variable | Purpose |
|---|---|
| `OPENSEARCH_ENDPOINT` | Collection endpoint URL |
| `OPENSEARCH_INDEX` | Index name (default `dsl-commands`) |
| `AWS_REGION` / `AWS_REGION_KEY` | Region for SDKs |
| `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS` | Bedrock embedding |
| `LLM_MODEL`, `LLM_REGION` | Bedrock LLM or **inference profile** id |
| `RETRIEVAL_TOP_K` | kNN top-k |
| `MAX_QUERY_TOKENS` | Approximate max query length before truncation |
| `FORCE_RECREATE_INDEX` | Indexer: recreate index |
| `ASSISTANT_API_URL` / `ASSISTANT_URL` | CLI: API base URL |
| `OPENSEARCH_EXTRA_PRINCIPAL_ARNS` | CDK synth/deploy: extra IAM ARNs for OpenSearch **data** access policy |

---

## 11. Constraints and Limitations (MVP)

| Limitation | Description |
|---|---|
| No command validation | Output is not verified against syntax rules |
| No retry/correction loop | If the LLM produces an incorrect command, it is returned as-is |
| No session memory | Each request is independent; prompt instructs single-turn English only |
| Refusal in `command` field | Refusal text may be multi-line but uses the same JSON field |
| No agent architecture | Single-step pipeline |
| No VPC | Public endpoints; dev-oriented |
| Fixed knowledge base | 40 commands; adding new ones requires re-indexing |
| Model access | Bedrock + Marketplace + Anthropic FTU may be required per account |

---

## 12. Future Enhancements (Post-MVP)

- **DSL validation layer**: Regex-based syntax verification against known command formats
- **Retry/correction loop**: If validation fails, re-prompt the LLM with the error
- **Structured output**: Separate fields for `kind: command | refusal`
- **Agent architecture**: Multi-step reasoning with tool calls for complex queries
- **Session memory**: Optional follow-up queries (contradicts current PRD until product decides)
- **VPC deployment**: Production networking
- **Expanded knowledge base**: More Sabre categories

---

## 13. Success Criteria

The MVP is successful if:

1. The system correctly translates a high share of queries aligned with the 40 known command patterns
2. End-to-end latency is acceptable for interactive use
3. The system can be deployed to AWS with the documented CDK stack order + bootstrap
4. Local workflow (indexer, assistant, CLI against deployed API) works when IAM and Bedrock access are configured
5. The architecture remains extensible for post-MVP enhancements without a full rewrite
