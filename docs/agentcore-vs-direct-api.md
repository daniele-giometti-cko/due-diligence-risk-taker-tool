# Architecture Comparison: AgentCore Gateway vs Direct API Call

This document compares the two realistic approaches for adding Datadog log querying to the Due Diligence Chronicle feature.

---

## What we are comparing

| | Option A: AgentCore Gateway | Option B: Direct API call |
|---|---|---|
| Call path | .NET → Bedrock Agent → AgentCore → Datadog MCP | .NET → Datadog Logs API (REST) |
| AI role | Bedrock Agent orchestrates: decides which tools to call, iterates, synthesises | .NET assembles the log payload, passes it to Bedrock `InvokeModel` |
| Deployment | AWS-managed (no server to run) | No extra AWS service; Datadog SDK/HTTP client only |
| Auth | AgentCore pulls from Secrets Manager; Bedrock IAM | .NET reads from Secrets Manager directly |

---

## Option A — AgentCore Gateway + Bedrock Agent

### How it works

```
User prompt
    │
    ▼
POST /chronicle/generate  (.NET)
    │
    ▼
BedrockAgentService.InvokeAgent()
    │
    ▼
Bedrock Agent (Claude)
    │  "I need to query Datadog"
    ▼
AgentCore Gateway  ──→  Datadog MCP  ──→  Datadog Logs API
    │                   (tool result)
    ▼
Agent synthesises chronicle
    │
    ▼
.NET returns narrative to UI
```

### Pros

- **AI-driven tool selection.** The agent decides *what* to query, *how many times*, and *how to refine* — it can issue follow-up queries if the first result is sparse. You don't have to hardcode query construction logic in .NET.
- **Agentic behaviour is reusable.** The same Bedrock Agent can be pointed at any future MCP-compatible data source (AWS Cost Explorer MCP, GitHub MCP, etc.) without changing .NET code.
- **MCP as a standard protocol.** Your .NET code becomes a thin caller; it doesn't need to know Datadog's query DSL at all — the agent and Datadog MCP handle that conversation.
- **AWS-managed auth and transport.** AgentCore handles OAuth flows, retries, and throttle back-off against the MCP endpoint. Credentials never touch your application code.
- **Good learning investment.** AgentCore Gateway is the direction AWS is pushing for agent-to-external-service integrations. Building this now gives you production-ready patterns for the team.
- **Multi-step reasoning.** Agent can correlate across multiple queries: e.g. "check the notifier logs, then check the DDB state for those case IDs" — two tool calls in one agent turn.

### Cons

- **Higher latency.** One round-trip: .NET → Bedrock Agent → MCP → Datadog → back. The agent may issue multiple tool calls before producing output. Expect 5–15 s for a simple chronicle vs < 1 s for a direct query.
- **More moving parts.** AgentCore Gateway + Bedrock Agent are additional AWS resources to provision, monitor, and pay for. If AgentCore is unavailable, the entire feature is unavailable.
- **Harder to debug locally.** You can't step through the agent's reasoning in a debugger. You rely on CloudWatch traces and the Bedrock console to understand what tool calls were made.
- **Cost.** You pay for: Bedrock input/output tokens (agent reasoning), AgentCore invocations, and Datadog API calls. For a low-traffic internal tool this is negligible, but it stacks up under heavy use.
- **AgentCore is newer.** The CLI/SDK API surface was still evolving in early 2025. Expect occasional breaking changes and thinner community documentation compared to stable services.
- **You don't control the query.** The agent constructs the Datadog query based on the prompt. If it consistently produces suboptimal queries you have to tune the system prompt rather than fix a line of code.

---

## Option B — Direct Datadog API call

### How it works

```
User prompt
    │
    ▼
POST /chronicle/generate  (.NET)
    │
    ▼
DatadogService.SearchLogsAsync(service, timeRange)
    │  HTTP GET  logs/list
    ▼
Datadog Logs API  ──→  returns raw log events
    │
    ▼
AiQueryService.GenerateChronicleAsync(logEvents)
    │  InvokeModel (not InvokeAgent)
    ▼
Bedrock Claude narrates the pre-fetched events
    │
    ▼
.NET returns narrative to UI
```

This is essentially what CloudWatch Chronicle already does — swap CloudWatch Insights for Datadog Logs API, keep the same Bedrock `InvokeModel` narration step.

### Pros

- **Simple, debuggable.** The query is a plain HTTP call. You can curl it, log the response, write a unit test against a mock. No orchestration layer.
- **Fast.** Datadog query + Bedrock narration in parallel if you want. Total latency is ~1–3 s.
- **Exact query control.** You define the `ddsource`, `service`, time window, and filter in code. No prompt engineering needed to get consistent queries.
- **Low infrastructure footprint.** No new AWS resources. Just an `HttpClient` + Secrets Manager read. Works the same way in local dev, staging, and prod.
- **Consistent with the existing CloudWatch Chronicle pattern.** The team already understands the pattern; less onboarding friction.
- **Easier cost visibility.** One Bedrock `InvokeModel` call per chronicle request. Predictable.

### Cons

- **You own the query logic.** If the Datadog query DSL changes, or you want to add more filter dimensions (e.g. correlation IDs), you update .NET code.
- **Single-shot.** You query once, pass the result to Claude, get a narrative. If the result set is empty or misleading, Claude can't self-correct by issuing a follow-up query — that requires code changes.
- **No agentic extension path.** If you later want "also check the related DDB records", you write that in .NET, not in a prompt.
- **Learning value is lower.** You are not exercising AgentCore or MCP. If the goal is to learn AWS agentic tooling, this approach teaches you nothing new.
- **Pagination.** Datadog Logs API paginates. You have to handle cursors in code; the MCP/agent handles this transparently.

---

## Side-by-side summary

| Dimension | AgentCore Gateway | Direct API |
|---|---|---|
| Latency | 5–15 s (multi-tool turns) | 1–3 s |
| Query flexibility | AI-driven, self-refining | Fixed in code |
| Debug experience | CloudWatch traces, Bedrock console | Standard HTTP logs, unit-testable |
| Infrastructure cost | AgentCore + Bedrock Agent resources | Minimal (HttpClient only) |
| Code complexity | Low (.NET is a thin caller) | Medium (query builder + pagination) |
| Learning value | High (AgentCore, MCP, agentic patterns) | Low (already done with CloudWatch) |
| Resilience | Depends on AgentCore availability | Direct HTTP; one less failure domain |
| Multi-source correlation | Yes (agent can call multiple tools) | Only if you write the orchestration |
| Local dev | Hard (requires real AWS resources) | Easy (mock HTTP, no special setup) |

---

## Recommendation

For **this specific project** the choice depends on the primary goal:

- If the goal is **learning AgentCore / MCP** (which was stated as the motivation): go Option A. The latency and extra infra are acceptable trade-offs for an internal tool, and you gain production-ready experience with a service the team will likely use more broadly.

- If the goal is **shipping a reliable chronicle feature as fast as possible**: go Option B. It mirrors the CloudWatch pattern already in the codebase and you can have it working in a day.

A pragmatic middle path: **build Option B first** (direct Datadog API, same architecture as CloudWatch Chronicle). It gives you a working feature immediately. Then layer Option A in parallel as a learning exercise against a separate endpoint (e.g. `POST /chronicle/generate-agentic`). You can compare results and latency side by side before deciding which to default to in the UI.

---

## What does not change between the two options

- Secrets Manager stores Datadog credentials in both cases.
- The UI Chronicle panel is identical — it just calls a different backend endpoint.
- Bedrock is used in both (either `InvokeAgent` or `InvokeModel`).
- The "AI never executes queries on its own" invariant holds in both — the user always triggers generation explicitly.
