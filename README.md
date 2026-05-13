# Due Diligence — Logs Teller Agent

An internal developer tool for querying production observability data in plain English.
The primary feature is the **Datadog Chronicle** — an agentic flow where Claude (via AWS AgentCore Runtime) queries Datadog and narrates what happened, streamed back to your browser in real time.

It also includes an assistive **DynamoDB** query mode, where the AI drafts a Query/Scan and you review/edit before executing.

> **DynamoDB mode is for lower environments only (QA).** It's intended for ad-hoc data inspection during development and is not wired up for production accounts. Datadog Chronicle works across all environments.

---

## What it does

```
┌──────────────────────────────────────────────────────────────┐
│  Browser (Next.js · localhost:3000)                          │
│  Tab switcher                                                │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ 1. Datadog Chronicle  (primary — agentic)            │    │
│  │    Type a prompt → streamed narrative back           │    │
│  └──────────────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ 2. DynamoDB          (AI-assisted · QA only)         │    │
│  │    NL prompt → Query/Scan JSON → review → execute    │    │
│  └──────────────────────────────────────────────────────┘    │
└──────────────────┬───────────────────────────────────────────┘
                   │ fetch / SSE
┌──────────────────▼───────────────────────────────────────────┐
│  .NET 8 API (localhost:5000)                                 │
│                                                              │
│  POST /agent-chronicle/stream  → AgentCore Runtime (SSE)     │
│  POST /query/{generate,execute}-query  (DynamoDB)            │
└────────┬─────────────────────────────────────────┬───────────┘
         │ SigV4                                   │
┌────────▼──────────────────────────────┐   ┌──────▼──────────┐
│  AgentCore Runtime  (Python · AWS)    │   │  AWS SDK calls  │
│  Strands Agent + Datadog MCP          │   │  DynamoDB       │
│  Streams chronicle text + token usage │   │                 │
└───────────────────────────────────────┘   └─────────────────┘
```

For the DynamoDB mode, the AI **generates** the query but **never executes it** — you always see and can edit the JSON before anything runs. The Datadog Chronicle agent is autonomous within hard limits (≤2 queries, ≤50 logs per query, ≤300 word output) and never exposes raw payloads.

---

## Prerequisites

| Requirement | Notes |
|---|---|
| [.NET SDK](https://dotnet.microsoft.com/download) 8.0+ | API |
| [Node.js](https://nodejs.org) 18+ | UI |
| AWS credentials | `~/.aws/credentials` — profiles for the accounts you want to query |
| Bedrock bearer token | For local Claude invocations (DynamoDB mode) |

The Python AgentCore Runtime is **already deployed in AWS** — you don't need Python locally unless you're redeploying the agent (see "Redeploying the AgentCore Runtime" below).

---

## Setup

### 1. Configure the API

```bash
cd api

# One-time: store the Bedrock bearer token in .NET user secrets (never committed)
dotnet user-secrets init
dotnet user-secrets set "Bedrock:BearerToken" "bedrock-api-key-..."
```

> The Bedrock bearer token expires after **12 hours**. When it does, repeat the `dotnet user-secrets set` command and restart the API.

Open `api/appsettings.json` and verify:
- `AWS:Region` (default `eu-west-1`)
- `Bedrock:ModelId` (default `eu.anthropic.claude-sonnet-4-6`)
- `Bedrock:AgentRuntimeArn` (points to the AgentCore Runtime in `cko-gen3-qa`)
- `Bedrock:Profile` (the AWS profile used to sign AgentCore calls — `cko-gen3-qa`)

### 2. Configure the UI

The frontend ships with a pre-configured `ui/.env.local` pointing to `http://localhost:5000`. No changes needed for local use.

---

## Running the tool

You need **two terminals** — one for the API, one for the UI.

### Terminal 1 — Start the API

```bash
cd api

# AWS credentials are picked up from ~/.aws/credentials.
# The DynamoDB profile is selected in the UI dropdown.
# The profile for AgentCore SigV4 signing is configured in appsettings.json (Bedrock:Profile).

dotnet run
```

API → **http://localhost:5000**
Swagger → **http://localhost:5000/swagger**

### Terminal 2 — Start the UI

```bash
cd ui
npm install   # first time only
npm run dev
```

UI → **http://localhost:3000**

---

## Using the tool

### 1. Datadog Chronicle (primary)

Type a natural-language prompt describing what you want to investigate, for example:

- `What happened with PEP case scraper failures in the last hour?`
- `Summarise IDV plugin errors today`
- `Why did the LLM adjudicator spike at 14:00 UTC?`

The agent runs at most **2 Datadog queries** (≤50 logs each), writes a ≤300-word past-tense chronicle, and streams the text into the UI as it's generated. Token usage is shown when the run completes. Your last 20 prompts are kept in browser localStorage.

### 2. DynamoDB (AI-assisted, lower environments only)

DynamoDB mode targets QA accounts only — pick the appropriate profile from the dropdown before generating or executing a query. It's intended for inspecting test data during development, not for production lookups.

1. *(Optional)* Select a table from the dropdown.
2. Type your question, for example:
   - `Get all items where PK is USER#123`
   - `Scan for records where status is PENDING, limit 50`
   - `Query the orders index for customer CUST#456 sorted by date`
3. Click **Generate Query** — the AI returns a `DynamoQuery` JSON object.
4. Review/edit the JSON, then **Execute Query**.

You can also use the **Manual Query Builder** to skip the AI step and fill the form directly (operation, table, PK/SK, filter, GSI, limit).

#### DynamoQuery shape

```jsonc
{
  "operation": "Query",            // "Query" or "Scan"
  "table": "my-table",
  "keyCondition": "PK = :pk",
  "filterExpression": null,        // optional
  "expressionValues": { ":pk": "USER#123" },
  "indexName": null,               // GSI name, if any
  "limit": null,                   // null = no limit
  "profile": null                  // optional — AWS profile to use for this call
}
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Bedrock:BearerToken is not configured` | `dotnet user-secrets set "Bedrock:BearerToken" "..."` in `api/`, restart |
| Bedrock returns 403 / token errors | The bearer token expired (12h TTL) — set a new one and restart the API |
| AgentCore call returns 403 | Check `Bedrock:Profile` resolves to credentials with `bedrock-agentcore:InvokeAgentRuntime` permission |
| Tables dropdown is empty | AWS credentials or region wrong — verify the profile in the UI dropdown and `AWS:Region` in `appsettings.json` |
| CORS error in browser | Ensure API is on port 5000 and UI on port 3000 |
| Datadog Chronicle returns nothing | Datadog API/App keys may be missing in Secrets Manager — see [docs/setup-from-scratch.md](docs/setup-from-scratch.md) |
| `KeyCondition is required` (DDB) | Switch operation to `Scan`, or provide a partition key value |

---

## Project structure

```
due-diligence-logs-teller-agent/
├── api/                  .NET 8 Web API (port 5000)
│   ├── Controllers/      QueryController · AgentChronicleController
│   ├── Services/         AiQueryService · DynamoDbService · AgentRuntimeService
│   └── Models/           Shared DTOs (DynamoQuery, AgentChronicleRequest, …)
├── ui/                   Next.js 14 frontend (port 3000)
│   ├── app/              App Router pages (tabs: Datadog · DynamoDB)
│   ├── components/       DatadogChronicle (primary) · DynamoDbExplorer · QueryInput · ResultsTable …
│   └── services/         API call wrappers
├── agentcore/            Python AgentCore Runtime container (deployed in AWS)
│   ├── agent_runtime.py  Strands Agent + Datadog MCP entrypoint
│   ├── deploy.py         First-time deploy: build, push to ECR, create runtime
│   └── update_runtime.py Update the existing runtime with a new image
└── docs/                 Setup and design notes
```

---

## Redeploying the AgentCore Runtime

The Python runtime runs in AWS — you don't run it locally. To redeploy after changes:

```bash
cd agentcore
source .venv/bin/activate        # or: python -m venv .venv && pip install -r requirements.txt
python update_runtime.py         # builds Docker image, pushes to ECR (cko-gen3-pg), updates runtime
```

Requires Docker running and AWS credentials with access to:
- ECR in `cko-gen3-pg` (cross-account — SCP blocks `CreateRepository` in `cko-gen3-qa`)
- AgentCore in `cko-gen3-qa`

See [docs/setup-from-scratch.md](docs/setup-from-scratch.md) for the full provisioning guide and [docs/issues-and-resolutions.md](docs/issues-and-resolutions.md) for known gotchas (SigV4, ECR, model IDs).
