# Travel Operator Assistant

Natural-language assistant for travel agency operators. It translates plain English requests into **Sabre GDS** host commands — the terse terminal syntax used for flight booking and lookups.

**Example**

```
find flights from JFK to London Heathrow on March 10 at 11am
→ 110MARJFKLHR11A
```

The system uses **RAG** (Retrieval-Augmented Generation): a catalog of ~40 Sabre command patterns is indexed in OpenSearch, relevant patterns are retrieved for each query, and an LLM generates a validated command string.

---

## Tech stack

| Layer | Technology |
|-------|------------|
| Runtime | [Bun](https://bun.sh) + TypeScript (monorepo) |
| Embeddings | Amazon Bedrock — Titan Embed Text v2 (1024 dims) |
| Vector search | Amazon OpenSearch Serverless (kNN + BM25 hybrid in V2) |
| LLM | Amazon Bedrock — Claude Haiku |
| API | AWS Lambda + API Gateway |
| Infrastructure | AWS CDK |
| Sabre execution | Sabre SOAP (LLS + dry-run via IgnoreTransaction) |

---

## Repository layout

```
travel-operator-assistant/
├── chunks.json                 # Knowledge base: 40 DSL command patterns
├── data/                       # Intent centroids, validation datasets, eval results
├── scripts/                    # Dataset generation, evaluation, Sabre validation
├── run-assistant.sh            # Demo entry point (interactive or one-shot)
├── demo-assistant.sh           # Batch demo queries for screen recording
└── packages/
    ├── core/                   # Shared config, embeddings, OpenSearch client, LLM
    ├── indexer/                # Index chunks.json into OpenSearch
    ├── assistant/              # V1 + V2 translation API (Lambda + local server)
    ├── cli/                    # Terminal client (REPL + debug pipeline)
    ├── sabre-command/          # Sabre SOAP client (run / validate commands)
    └── infra/                  # AWS CDK stacks
```

Further detail: [`eval-results-reference.md`](eval-results-reference.md) (V1 vs V2 metrics on the reference dataset).

---

## Prerequisites

- **Bun** 1.x
- AWS credentials with access to **Bedrock** and **OpenSearch Serverless**
- (Optional) Sabre cert credentials for live command execution in the CLI

---

## Setup

1. Install dependencies:

```bash
bun install
```

2. Copy environment template and fill in your values:

```bash
cp .env.example .env
```

Key variables: `AWS_REGION`, `OPENSEARCH_ENDPOINT`, `OPENSEARCH_INDEX`, `LLM_MODEL`, `LLM_REGION`, and Sabre SOAP settings (`SABRE_SOAP_URL`, `SABRE_USERNAME`, …).

3. Sync env into packages (optional helper):

```bash
bun run env:sync
```

4. Index the knowledge base (once, or after `chunks.json` changes):

```bash
bun run indexer:local
```

5. Precompute intent centroids for V2 (once, or after changing the embedding model):

```bash
bun run precompute:intent-centroids
```

---

## Run locally

### Assistant API

Starts a Bun HTTP server on port **3000** with V1 and V2 endpoints:

```bash
bun run assistant:local
```

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Health check |
| `POST /translate` | V1 pipeline (simple kNN RAG) |
| `POST /v2/translate` | V2 pipeline (rewrite, hybrid search, validation, sessions) |

Set `ASSISTANT_API_URL=http://localhost:3000` for the CLI (default).

### CLI — interactive demo

Best for screen recordings. Shows a welcome screen, colored debug pipeline, and optional Sabre dry-run:

```bash
# Terminal 1
bun run assistant:local

# Terminal 2
./run-assistant.sh
```

One-shot mode:

```bash
./run-assistant.sh "give me the airport code for charles de gaulle airport"
```

Batch demo script:

```bash
./demo-assistant.sh
```

### CLI flags

| Flag / env | Effect |
|------------|--------|
| `--v2` / `CLI_V2=1` | Use V2 API (default in `run-assistant.sh`) |
| `--debug` / `-d` / `CLI_DEBUG=1` | Show pipeline steps on stderr |
| `--sabre` / `CLI_SABRE=1` | Execute command in Sabre cert after generation (dry-run) |
| `CLI_STEP_DELAY_MS` | Delay between debug steps (default `300`) |
| `NO_COLOR=1` | Disable ANSI colors |

Alternative npm-style entry:

```bash
bun run cli:v2 -- --debug --sabre "your query here"
```

### Sabre command runner (standalone)

```bash
bun run sabre-command:local -- "*A"
bun run sabre-command:local -- --validate "110MARJFKLHR"
```

---

## Pipelines

### V1 (`POST /translate`)

Truncate → embed → kNN search (top-K) → prompt → LLM → command.

### V2 (`POST /v2/translate`)

1. Truncate query  
2. LLM query rewrite  
3. Hybrid retrieval (kNN + BM25, merged with RRF)  
4. Rule-based context augmentation  
5. Intent classification (centroid similarity)  
6. Prompt assembly (system + user catalog)  
7. LLM generation  
8. Command normalization + DSL validation + optional retry  

V2 also supports **multi-turn sessions**: send `history: [{ query, command }, …]` in the request body, or use the interactive CLI which keeps the last 10 turns client-side.

On the reference eval set (456 cases), V2 reaches **~92% success** vs **~77%** for V1. See [`eval-results-reference.md`](eval-results-reference.md).

---

## Evaluation

```bash
bun run evaluate:v1          # V1 on reference dataset
bun run evaluate:v2          # V2 on reference dataset
bun run validate:dataset-sabre   # Validate commands against Sabre cert API
```

---

## Deploy to AWS

```bash
bun run cdk:bootstrap        # once per account/region
bun run cdk:deploy           # all stacks
# or individually:
bun run cdk:deploy:opensearch
bun run cdk:deploy:indexer
bun run cdk:deploy:api
bun run cdk:deploy:sabre
```

After deploy, set `ASSISTANT_API_URL` to the API Gateway base URL (including stage, no trailing slash).

---

## Development

```bash
bun run check          # Biome lint + format
bun run check:fix      # Auto-fix
```

---

## License

Private / diploma project.
