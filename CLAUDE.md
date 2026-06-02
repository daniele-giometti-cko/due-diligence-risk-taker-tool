# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Due Diligence Agentic - Logs Teller Agent

Internal full-stack tool for querying Datadog logs and DynamoDB tables via AI. The primary feature is the **Datadog Chronicle** — a streaming, agentic flow where a Python container on AWS AgentCore Runtime uses Strands + Claude to query Datadog and narrate what happened. The **DynamoDB explorer** is a secondary mode for ad-hoc data inspection in lower environments (QA). Local developer use only — no deployment pipeline.

## Source layout

```
due-diligence-logs-teller-agent/
├── api/                                            # .NET 8 Web API (port 5000)
│   ├── Controllers/
│   │   ├── QueryController.cs                      # DynamoDB endpoints + profile/env-labels
│   │   └── AgentChronicleController.cs             # POST /agent-chronicle/{generate,stream} — SSE streaming
│   ├── Services/
│   │   ├── AiQueryService.cs                       # Bedrock invocation; DynamoDbSystemPrompt
│   │   ├── DynamoDbService.cs                      # Query/Scan executor; per-profile client creation; BuildExpressionValues
│   │   ├── AgentRuntimeService.cs                  # Hand-rolled SigV4; streams SSE from AgentCore Runtime; parses __METRICS__ sentinel
│   │   └── BedrockAgentService.cs                  # InvokeAgentAsync via EventStream (legacy, unused in production flow)
│   ├── Models/
│   │   └── Models.cs                               # DynamoQuery, GenerateQueryRequest, ExecuteQueryResponse, AgentChronicleRequest/Response, AgentStreamChunk
│   ├── Program.cs                                  # DI wiring; Bedrock client setup; CORS → localhost:3000
│   └── appsettings.json                            # AWS region, Bedrock config (ModelId, AgentRuntimeArn), EnvironmentLabels
├── ui/                                             # Next.js 14 App Router (port 3000)
│   ├── app/
│   │   ├── page.tsx                                # Root page — tab switcher between DatadogChronicle and DynamoDbExplorer
│   │   └── layout.tsx                              # HTML shell, monospace font, 2rem padding
│   ├── components/
│   │   ├── DatadogChronicle.tsx                    # PRIMARY: streams /agent-chronicle/stream; localStorage history (20 max); token counts
│   │   ├── DynamoDbExplorer.tsx                    # DDB mode wrapper: profile picker + QueryInput + ManualQueryBuilder + QueryPreview + ResultsTable
│   │   ├── QueryInput.tsx                          # NL input + table dropdown for DDB mode
│   │   ├── ManualQueryBuilder.tsx                  # PK/SK form builder
│   │   ├── QueryPreview.tsx                        # Editable JSON textarea
│   │   └── ResultsTable.tsx                        # Dynamic-column table
│   └── services/
│       └── queryService.ts                         # DDB + profile API calls
├── agentcore/                                      # Python AgentCore Runtime container
│   ├── agent_runtime.py                            # BedrockAgentCoreApp entrypoint; Strands Agent; Datadog MCP via Secrets Manager creds; streams via yield
│   ├── deploy.py                                   # bedrock-agentcore-starter-toolkit; Docker build + ECR push + create_agent_runtime
│   ├── update_runtime.py                           # update_agent_runtime with new ECR image URI
│   ├── requirements.txt                            # bedrock-agentcore, strands-agents, boto3, mcp, httpx
│   └── Dockerfile                                  # ARM64 container for AgentCore
├── docs/
│   ├── setup-from-scratch.md                       # Complete provisioning guide: accounts, regions, IAM, ECR, AgentCore Runtime
│   ├── agentcore-setup.md                          # (Deprecated) Classic Bedrock Agent + AgentCore Gateway approach — not used
│   ├── agentcore-vs-direct-api.md                  # Decision analysis: Gateway vs direct Datadog MCP from Python
│   └── issues-and-resolutions.md                   # 10 discovered issues + fixes; SigV4, ECR, Docker, Bedrock model IDs
└── due-diligence-logs-teller-agent.sln             # Visual Studio solution file
```

## Two query modes

### 1. Datadog Chronicle (primary — agentic)

The main feature. Natural language prompt → AgentCore Runtime (Python) → Strands Agent → Datadog MCP → streaming SSE chronicle back to the UI.

**Flow:**
1. User types prompt in `DatadogChronicle.tsx`
2. `POST /agent-chronicle/stream` → `AgentChronicleController` → `AgentRuntimeService.StreamChunksAsync`
3. `AgentRuntimeService` signs the request with SigV4 and streams SSE from the AgentCore Runtime endpoint
4. Python `agent_runtime.py` receives the prompt, fetches Datadog credentials from Secrets Manager, queries Datadog MCP via Strands, yields text chunks
5. At the end, Python emits `\n__METRICS__:{json}` sentinel with token counts
6. `.NET` parses the SSE stream, forwarding text chunks and extracting metrics; UI streams them in real-time

**Critical SigV4 invariants** (see `AgentRuntimeService.cs`):
- `runtimeSessionId` is a **header** (`X-Amzn-Bedrock-AgentCore-Runtime-Session-Id`), NOT a body field
- `content-type` must **NOT** be included in signed headers — boto3/botocore omits it for this service
- The canonical URI path must be **double-encoded** via `BotocoreCanonicalUri()` — `%3A` → `%253A`, matching AWS server-side verification
- Signed headers: `host`, `x-amz-date`, `x-amz-security-token`, `x-amzn-bedrock-agentcore-runtime-session-id`

### 2. DynamoDB (QA only — AI-assisted)

Natural language or manual builder → DynamoDB Query/Scan → results table. The AI **generates** the query; the user reviews/edits the JSON and executes. Intended for ad-hoc data inspection in lower environments only.

## Key domain contracts

### DynamoQuery — DDB contract

```json
{
  "operation": "Query" | "Scan",
  "table": "string",
  "keyCondition": "string",
  "filterExpression": "string | null",
  "expressionValues": { ":param": "value" },
  "indexName": "string | null",
  "limit": number | null,
  "profile": "string | null"
}
```

### AgentChronicleRequest — Datadog contract

```json
{ "prompt": "string", "sessionId": "string | null" }
```

The frontend TypeScript interfaces in `queryService.ts` must stay in sync with these C# models. JSON is camelCase throughout (configured in `Program.cs`).

## AI flows

### Datadog chronicle AI flow

1. Prompt → `POST /agent-chronicle/stream`
2. `AgentRuntimeService` signs + POSTs to `https://bedrock-agentcore.{region}.amazonaws.com/runtimes/{encodedArn}/invocations?qualifier=DEFAULT`
3. AgentCore Runtime (`agent_runtime.py`) receives prompt, fetches DD creds from Secrets Manager, creates Strands Agent with Datadog MCP tools
4. Agent uses at most 2 Datadog queries (limit 50 logs each), writes chronicle (≤300 words), emits `__METRICS__` sentinel
5. `AgentRuntimeService` parses stream, yields `AgentStreamChunk` records to the controller
6. `AgentChronicleController` forwards as SSE `data: {json}` events
7. `DatadogChronicle.tsx` appends text chunks, captures token counts on final metrics chunk

### DDB AI flow

1. Natural language → `POST /query/generate-query`
2. `AiQueryService.InvokeBedrockAsync` → Bedrock `InvokeModelAsync`; model from `appsettings.json` (`eu.anthropic.claude-sonnet-4-6` default)
3. Returns typed `DynamoQuery` struct. **AI never executes anything.**
4. User reviews/edits JSON in preview textarea
5. User clicks Execute → `POST /query/execute-query`

## AI prompt contracts

`AiQueryService` has one `const string` prompt:

- **DynamoDbSystemPrompt:** JSON-only, `:param` notation, Query/Scan schema

`agent_runtime.py` has its own `SYSTEM_PROMPT` for Datadog: ≤2 queries, limit 50, ≤300 words, never expose raw logs.

## AWS infrastructure

### Existing (already provisioned)

| Resource | Type | Account | Region | Notes |
|---|---|---|---|---|
| `cko-gen3-qa` | AWS Account | 944945738260 | eu-west-1 | Application workload. Same physical account the DD team labels `cko-merchant-risk-assessment-qa` in sibling repos. |
| `due_diligence_logs_teller_agentruntime` | AgentCore Runtime | cko-gen3-qa | eu-west-1 | Python ARM64 container; ARN in appsettings.json |
| `due-diligence-logs-teller-runtime-role` | IAM Role | cko-gen3-qa | — | Trust: `bedrock-agentcore.amazonaws.com` |
| `due-diligence/logs-teller-agent/dd-api-key` | Secrets Manager | cko-gen3-qa | eu-west-1 | Datadog API key |
| `due-diligence/logs-teller-agent/dd-app-key` | Secrets Manager | cko-gen3-qa | eu-west-1 | Datadog Application key |
| `bedrock-agentcore-due_diligence_logs_teller_agentruntime` | ECR Repository | cko-gen3-**pg** | eu-west-1 | Cross-account (SCP blocks CreateRepository in qa) |

### Planned (productionization — ECS Fargate behind internal ALB)

Provisioned via inline `iac/` (Spacelift/OpenTofu, 100/160/200/300 layered, scraper-style). Per-environment; QA first. Naming `${var.env}-logs-teller-${component}`.

| Resource | Type | Account | Region | Notes |
|---|---|---|---|---|
| `logs-teller-agent-api` | ECR Repository | cko-artifact (891377407345) | eu-west-1 | .NET API image. Pull granted cross-account to qa/prod; push from `cko-gh`. |
| `logs-teller-agent-ui` | ECR Repository | cko-artifact (891377407345) | eu-west-1 | Next.js BFF image. |
| ECS Fargate cluster | ECS | cko-gen3-qa | eu-west-1 | Two services: API (container port 5000) and UI/BFF (port 3000). |
| Shared internal ALB listener rules + TGs | ELB | cko-gen3-qa | eu-west-1 | Wired into the shared `dd_network` HTTPS listener via remote state. `/api/*` → API; default → UI. Health `/api/_system/ping`. `internal`, `assign_public_ip=false`. |
| API task role | IAM Role | cko-gen3-qa | — | `bedrock-agentcore:InvokeAgentRuntime` on the existing runtime ARN; `secretsmanager:GetSecretValue` on this app's secret(s); `dynamodb:Query/Scan` on QA tables (qa stack only); KMS decrypt. |
| UI/BFF task role | IAM Role | cko-gen3-qa | — | `secretsmanager:GetSecretValue` on the app secret (Okta secret, NEXTAUTH_SECRET, downstream API key); KMS decrypt. No data-plane access. |
| Task execution role(s) | IAM Role | cko-gen3-qa | — | ECR pull, CloudWatch Logs, Secrets Manager read for task bootstrap. |
| `due-diligence/logs-teller-agent/api-secrets` | Secrets Manager | cko-gen3-qa | eu-west-1 | Downstream `X-API-KEY`, Bedrock bearer token. (per env) |
| `due-diligence/logs-teller-agent/ui-secrets` | Secrets Manager | cko-gen3-qa | eu-west-1 | Okta client secret + client id, `NEXTAUTH_SECRET` (cookie encryption). (per env) |
| App KMS CMK | KMS | cko-gen3-qa | eu-west-1 | Encrypts secrets + logs. |
| CloudWatch log groups | CloudWatch | cko-gen3-qa | eu-west-1 | `/aws/ecs/logs-teller-{api,ui}`; forwarded to Datadog. |

**Auth boundary (decided):** Okta session terminates at the Next.js BFF (HTTP-only encrypted cookie); the BFF injects `X-API-KEY` server-side; the .NET API validates `X-API-KEY` only (Checkout.Gateway), never the Okta token. Auth is conditional — empty config ⇒ both tiers run unauthenticated for local dev. See `docs/architecture/`.

**Versioning & CI (decided):** `GitVersion.yml` (GitVersion) + reusable workflows from `cko-transformation/due-diligence-actions` (`ci-build-docker`, `release-gh`, `ci-deploy-service`, `ci-deploy-service-ui`, `codeql-analysis-csharp`). No plain VERSION files.

**Observability & base images (decided):** Checkout.Diagnostics + Serilog → Datadog; CKO `pki-dotnet:aspnet-8.0.x-alpine` (API) and `pki-node` (UI) base images; `nuget.config` → CKO CodeArtifact.

**AgentCore Runtime ARN** (in `appsettings.json`):
```
arn:aws:bedrock-agentcore:eu-west-1:944945738260:runtime/due_diligence_logs_teller_agentruntime-ZRS6L187pp
```

**Bedrock models:**
- DDB local invocations: `eu.anthropic.claude-sonnet-4-6` (via `Bedrock:ModelId` in appsettings)
- AgentCore Python runtime: `eu.anthropic.claude-sonnet-4-5-20250929-v1:0` (via `MODEL_ID` env var)

## Per-profile DynamoDB clients

`DynamoDbService` creates short-lived, profile-specific AWS clients on demand using `CredentialProfileStoreChain`. The DI-injected default client is used only when no profile is selected. Always `using var` / `Dispose()` profile clients after the call.

## Environment labels

`appsettings.json → EnvironmentLabels` maps profile names to human-readable labels shown in the UI dropdown. Current mapping: `cko-g2-dev` = "Gen2 Dev (= Gen3 Dev)" (Gen3 has no dev environment).

## Key invariants

- **AI must never execute DDB queries.** Generation and execution are always separate explicit user actions.
- **Validate before executing.** `QueryController` enforces non-empty `Table` and `KeyCondition`. Do not remove these guards.
- **DynamoDB and Datadog data may contain Due Diligence domain data** (PEP screening results, entity records, case data). Never log raw result payloads — log counts and resource names only.
- **Bedrock bearer token must never appear in source or config files.** Store via `dotnet user-secrets set "Bedrock:BearerToken" "..."`. Injected into `AWS_BEARER_TOKEN_BEDROCK` at startup in `Program.cs`.
- **`expressionValues` keys must use `:param` notation** — DynamoDB SDK requirement enforced by the AI prompt.
- **AgentCore SigV4 canonical URI must double-encode** — `BotocoreCanonicalUri()` re-encodes non-unreserved chars so `%3A` → `%253A`. This matches AWS server-side verification. Do not replace with `Uri.EscapeDataString` on the path.
- **content-type must NOT be signed** for `bedrock-agentcore` requests — botocore omits it; signing it causes 403 errors.

## Local development

### API

```bash
cd api

# One-time: store the Bedrock bearer token in user secrets
dotnet user-secrets init
dotnet user-secrets set "Bedrock:BearerToken" "bedrock-api-key-..."

# AWS credentials come from ~/.aws/credentials (profile selected in UI or set in appsettings.json)
# For AgentCore invocations the API uses the profile in Bedrock:Profile (cko-gen3-qa)

dotnet run
# Swagger UI → http://localhost:5000/swagger
```

`Bedrock:BearerToken` expires after 12 hours. Refresh with another `dotnet user-secrets set` and restart.

### UI

```bash
cd ui
npm install   # first time only
npm run dev
# → http://localhost:3000
```

`ui/.env.local` sets `NEXT_PUBLIC_API_URL=http://localhost:5000`. Both services must run simultaneously.

### AgentCore Runtime (Python)

The Python runtime runs in AWS — you don't run it locally. To redeploy after changes:

```bash
cd agentcore
source .venv/bin/activate        # or create: python -m venv .venv && pip install -r requirements.txt
python update_runtime.py         # builds Docker image, pushes to ECR (cko-gen3-pg), updates runtime
```

Requires Docker running and AWS credentials with access to ECR in `cko-gen3-pg` and AgentCore in `cko-gen3-qa`.

## Testing

No tests exist yet.

# TODO: xUnit tests for DynamoDbService.BuildExpressionValues (null map, mixed JsonElement types).
# TODO: xUnit tests for QueryController validation guards.
