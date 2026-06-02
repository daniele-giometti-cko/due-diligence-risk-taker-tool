# Risk-Taker Tool — QA POC deployment

A hand-built proof-of-concept that runs the **.NET API** on ECS Fargate in **cko-gen3-qa**
(944945738260, eu-west-1), reachable internally over Cloudflare WARP. Built to demo the
Datadog Chronicle mode end-to-end against the in-account AgentCore runtime. **Not** the
final architecture — Phase 4 will codify this in Terraform with the Okta BFF in front.

## How to reach it

- **URL (over WARP):** `https://risk-taker-tool.merchant-risk-assessment.qa.ckotech.internal`
- Health: `GET /health` → `{"status":"ok"}`
- Flagship: `POST /agent-chronicle/generate` (JSON `{"prompt":"..."}`) and `POST /agent-chronicle/stream` (SSE)
- DynamoDB endpoints (`/query/*`) are deployed but DDB generate needs a Bedrock path / tables — out of POC scope.

### Demo from the local UI ("API in the cloud, UI on your laptop")

The deployed API's CORS allows `http://localhost:3000`. Point the local UI at it:

```bash
cd ui
# temporarily, for the demo:
echo 'NEXT_PUBLIC_API_URL=https://risk-taker-tool.merchant-risk-assessment.qa.ckotech.internal' > .env.local
npm run dev    # http://localhost:3000 → streams from the cloud API
```

(Restore `.env.local` to `http://localhost:5000` for normal local dev.)

## What was created (all tagged `risktaker=poc`)

| Resource | Account | Identifier |
|---|---|---|
| ECR repo (image home) | cko-gen3-pg (101852531977) | `risktaker-poc-api` → `101852531977.dkr.ecr.eu-west-1.amazonaws.com/risktaker-poc-api:poc` (arm64) + cross-account pull policy for gen3-qa |
| Private ACM cert | cko-gen3-qa | `…:certificate/199e03b5-a19e-4022-81eb-51597b30a538` (CN `risk-taker-tool.merchant-risk-assessment.qa.ckotech.internal`, shared PCA `471112826941`) |
| Execution role | cko-gen3-qa | `risktaker-poc-exec-role` (AmazonECSTaskExecutionRolePolicy) |
| Task role | cko-gen3-qa | `risktaker-poc-task-role` (inline: `bedrock-agentcore:InvokeAgentRuntime` on the runtime ARN, `secretsmanager:GetSecretValue` on `due-diligence/logs-teller-agent*`, `bedrock:InvokeModel`) |
| Security group | cko-gen3-qa | `sg-0007f8466c283e298` (ingress 8080 from ALB SG `sg-0028e3e1016722890`) |
| Target group | cko-gen3-qa | `risktaker-poc-tg` (ip, HTTP:8080, health `/health`) |
| CloudWatch log group | cko-gen3-qa | `/aws/ecs/risktaker-poc` (7-day retention) |
| ECS task definition | cko-gen3-qa | `risktaker-poc-api:1` (Fargate, ARM64, 512/1024) |
| ECS service | cko-gen3-qa | `risktaker-poc-api` on cluster `duediligence_ecs`, private subnets, desired 1 |
| ALB listener cert (SNI) | cko-gen3-qa | added the cert above to the HTTPS:443 listener of `duediligence-int-lb` |
| ALB listener rule | cko-gen3-qa | priority 100, host-header → target group (`…/listener-rule/…/1792af9a81ea1285`) |
| Route53 record | cko-gen3-qa | A-alias `risk-taker-tool.…` → ALB, zone `Z040419528EXGV97K01V1` |

### Reused (NOT created, do not delete)

VPC `vpc-0870296d0b0ef321a`, ALB `duediligence-int-lb`, ECS cluster `duediligence_ecs`,
the AgentCore runtime + `due-diligence/logs-teller-agent*` secrets, private zone
`merchant-risk-assessment.qa.ckotech.internal`.

## Notes / shortcuts taken (to revisit for the real thing)

- Stock `mcr.microsoft.com` base image, not the CKO `pki-dotnet` base.
- Built **ARM64** (Apple-Silicon-native; amd64 cross-build segfaulted under QEMU). Fargate task is ARM64 to match.
- No Okta/BFF yet — browser calls the API directly (CORS-allowed localhost). The real build puts the BFF in front and the API behind `X-API-KEY`.
- Hand-created via CLI. The teardown script is `scripts/risktaker-poc-teardown.sh`.

## Teardown

```bash
./scripts/risktaker-poc-teardown.sh
```

Removes everything above in dependency order. Reused resources are left untouched.
