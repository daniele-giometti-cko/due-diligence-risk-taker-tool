# Architecture Diagrams

This directory contains the target engineering views for the **Due Diligence Risk-Taker Tool** once productionized (ECS Fargate, internal ALB, Okta BFF). These reflect the decisions in the parent `CLAUDE.md` and supersede the local-only developer setup.

## Included diagrams

- [System Overview](./system-overview.mmd)
  - End-to-end runtime view from an internal engineer through Cloudflare WARP and the shared internal ALB to the Next.js BFF and the .NET API.
- [Container View](./container-view.mmd)
  - C4-style container breakdown: Next.js BFF (Okta session + X-API-KEY injection), .NET 8 API (Datadog Chronicle SSE + DynamoDB explorer), and the external integrations (AgentCore Runtime, DynamoDB, Secrets Manager, Okta, Datadog).
- [Deployment View](./deployment-view.mmd)
  - AWS runtime and delivery flow, including GitHub Actions (`due-diligence-actions` reusable workflows), Spacelift/OpenTofu, ECR, and per-environment ownership.

## Diagram intent

- Use the system overview when discussing product boundaries and request flow.
- Use the container view when changing application responsibilities, the auth boundary, or contracts.
- Use the deployment view when changing AWS topology, CI/CD, or infrastructure ownership.

## Key invariants reflected here

- **Auth boundary:** the browser only ever holds an HTTP-only encrypted Okta session cookie. The Next.js BFF holds the Okta tokens and the downstream `X-API-KEY`, which it injects server-side. The .NET API validates `X-API-KEY` only — it never sees the Okta token.
- **SSE preserved:** `/agent-chronicle/stream` streams in real time browser → BFF (streaming proxy) → API → AgentCore Runtime. Nothing in the path may buffer the response.
- **AgentCore SigV4 unchanged:** the API signs `bedrock-agentcore` requests with the hand-rolled SigV4 in `AgentRuntimeService` (session-id as header, `content-type` unsigned, double-encoded canonical URI). The task role provides the credentials at runtime.
- **Auth is conditional:** when the Okta/`X-API-KEY` config is absent (local dev), both tiers run unauthenticated so the developer experience is preserved.

## Source of truth

These diagrams reflect the implementation in:

- `ui/` (Next.js App Router + Okta BFF)
- `api/` (.NET 8 Web API)
- `agentcore/` (Python AgentCore Runtime — already deployed)
- `iac/` (Spacelift/OpenTofu, 100/160/200/300 layered)
- `.github/workflows` (calls `cko-transformation/due-diligence-actions`)
