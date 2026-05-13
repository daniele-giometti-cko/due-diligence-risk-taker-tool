# Due Diligence Agentic - Logs Teller Agent — Setup From Scratch

This guide walks through every step needed to rebuild the full stack from zero. It reflects the **actual working architecture**, not the original plan — several things changed during discovery (see `issues-and-resolutions.md` for the full story).

---

## What you are building

A pipeline that lets the .NET API ask "what happened in service X in the last N hours?" and get back a plain-English chronicle sourced from real Datadog logs.

```
.NET AgentChronicleController
    │  HTTP POST + SigV4
    ▼
AgentCore Runtime (Python container on AWS)
    │  Strands agent, Claude Sonnet 4.5
    ▼
Datadog MCP Server (mcp.datadoghq.eu)
    │  credentials fetched from Secrets Manager
    ▼
Datadog Logs API
    │  results streamed back as SSE
    ▼
.NET assembles narrative string → returns to caller
```

---

## Final Architecture

### Component diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Developer machine / deployed service                                   │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  .NET API  (DueDiligenceLogsTellerAgent.Api)                     │  │
│  │                                                                  │  │
│  │  POST /agent-chronicle/generate                                  │  │
│  │       │                                                          │  │
│  │       ▼                                                          │  │
│  │  AgentChronicleController                                        │  │
│  │       │                                                          │  │
│  │       ▼                                                          │  │
│  │  AgentRuntimeService.InvokeAsync()                               │  │
│  │    • hand-rolled SigV4 (no SDK package exists)                   │  │
│  │    • POST https://bedrock-agentcore.eu-west-1.amazonaws.com      │  │
│  │           /runtimes/{encoded-arn}/invocations?qualifier=DEFAULT  │  │
│  │    • streams SSE response back to caller                         │  │
│  └──────────────────────┬───────────────────────────────────────────┘  │
└─────────────────────────┼───────────────────────────────────────────────┘
                          │  HTTPS + SigV4  (cko-gen3-qa credentials)
                          ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  AWS — cko-gen3-qa  (944945738260)  eu-west-1                          │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  AgentCore Runtime                                               │  │
│  │  name: due_diligence_logs_teller_agentruntime                    │  │
│  │  ARN:  …:runtime/due_diligence_logs_teller_agentruntime-ZRS6L…  │  │
│  │                                                                  │  │
│  │  Runs: Python container (ARM64)                                  │  │
│  │  ┌────────────────────────────────────────────────────────────┐  │  │
│  │  │  agent_runtime.py  (Strands + BedrockAgentCoreApp)         │  │  │
│  │  │                                                            │  │  │
│  │  │  1. On cold start: fetch DD credentials from              │  │  │
│  │  │     Secrets Manager (cached for container lifetime)        │  │  │
│  │  │  2. Build MCPClient → Datadog MCP                         │  │  │
│  │  │  3. Create Strands Agent with Claude Sonnet 4.5            │  │  │
│  │  │  4. Per request: stream agent.stream_async(prompt)        │  │  │
│  │  └────────────────────────────────────────────────────────────┘  │  │
│  │  IAM role: due-diligence-logs-teller-runtime-role                │  │
│  │  Image:    101852531977.dkr.ecr.eu-west-1.amazonaws.com/…        │  │
│  └────────┬──────────────────┬────────────────────────────────────┘  │
│           │                  │                                         │
│           │ InvokeModel      │ GetSecretValue                          │
│           ▼                  ▼                                         │
│  ┌──────────────┐   ┌────────────────────────────────────────────┐    │
│  │  Amazon      │   │  Secrets Manager                           │    │
│  │  Bedrock     │   │                                            │    │
│  │              │   │  due-diligence/logs-teller-agent/dd-api-key│    │
│  │  Inference   │   │  due-diligence/logs-teller-agent/dd-app-key│    │
│  │  profile:    │   └────────────────────────────────────────────┘    │
│  │  claude-     │                                                      │
│  │  sonnet-4-5  │                                                      │
│  └──────────────┘                                                      │
└─────────────────────────────────┬───────────────────────────────────────┘
                                  │  HTTPS  (DD-API-KEY + DD-APPLICATION-KEY headers)
                                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Datadog EU  (external)                                                 │
│                                                                         │
│  MCP Server  mcp.datadoghq.eu/api/unstable/mcp-server/mcp              │
│    • tool: logs_list_events                                             │
│    • tool: logs_aggregate_events                                        │
│    • … 23 tools total                                                   │
│                                                                         │
│  Logs API  (called by the MCP server internally)                        │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│  AWS — cko-gen3-pg  (101852531977)  eu-west-1                          │
│                                                                         │
│  ECR repository                                                         │
│  bedrock-agentcore-due_diligence_logs_teller_agentruntime              │
│    • resource policy allows qa runtime role to pull                     │
│    • org SCP blocks ecr:CreateRepository in qa, so the repo lives here │
└─────────────────────────────────────────────────────────────────────────┘
```

### Request flow (step by step)

| Step | What happens |
|---|---|
| 1 | User calls `POST /agent-chronicle/generate` with a natural-language prompt |
| 2 | `AgentChronicleController` delegates to `AgentRuntimeService.InvokeAsync()` |
| 3 | .NET signs the request with SigV4 using the `cko-gen3-qa` credentials and POSTs to the AgentCore Runtime data-plane endpoint |
| 4 | AgentCore Runtime receives the request and invokes the Python entrypoint |
| 5 | On the first call (cold start), the Python agent fetches DD credentials from Secrets Manager and initialises an MCP session with the Datadog MCP server |
| 6 | The Strands agent sends the prompt to Claude Sonnet 4.5 via Bedrock |
| 7 | Claude decides which Datadog MCP tools to call (e.g. `logs_list_events`, `logs_aggregate_events`) and with what parameters |
| 8 | The MCP client calls the Datadog MCP server, injecting the DD credentials as HTTP headers |
| 9 | Datadog returns log events to the agent |
| 10 | Claude may issue additional tool calls if the first result needs refinement |
| 11 | Once Claude has enough data, it writes a plain-English chronicle and streams it back |
| 12 | The Python agent yields each text chunk via `yield event["data"]` |
| 13 | AgentCore Runtime SSE-encodes each chunk as `data: "..."` and streams it to the .NET caller |
| 14 | `AgentRuntimeService` reads the SSE stream, strips the JSON quotes, and assembles the full narrative string |
| 15 | The controller returns `{"narrative": "..."}` to the original HTTP caller |

### AWS resource inventory

| Resource | Type | Account | ARN / ID |
|---|---|---|---|
| `due-diligence-logs-teller-runtime-role` | IAM Role | cko-gen3-qa | `arn:aws:iam::944945738260:role/due-diligence-logs-teller-runtime-role` |
| `due_diligence_logs_teller_agentruntime` | AgentCore Runtime | cko-gen3-qa | `arn:aws:bedrock-agentcore:eu-west-1:944945738260:runtime/due_diligence_logs_teller_agentruntime-ZRS6L187pp` |
| `due-diligence/logs-teller-agent/dd-api-key` | Secrets Manager secret | cko-gen3-qa | Datadog API key |
| `due-diligence/logs-teller-agent/dd-app-key` | Secrets Manager secret | cko-gen3-qa | Datadog App key |
| `bedrock-agentcore-due_diligence_logs_teller_agentruntime` | ECR repository | cko-gen3-pg | `101852531977.dkr.ecr.eu-west-1.amazonaws.com/…` |

### IAM trust relationships

```
bedrock-agentcore.amazonaws.com
        │  assumes
        ▼
due-diligence-logs-teller-runtime-role  (in cko-gen3-qa)
        │
        ├─ bedrock:InvokeModel / InvokeModelWithResponseStream
        │    → arn:aws:bedrock:eu-west-1::foundation-model/*
        │    → arn:aws:bedrock:eu-west-1:944945738260:inference-profile/*
        │    → arn:aws:bedrock:eu-west-1::inference-profile/*
        │
        ├─ secretsmanager:GetSecretValue
        │    → arn:aws:secretsmanager:eu-west-1:944945738260:secret:due-diligence/logs-teller-agent/*
        │
        ├─ ecr:GetDownloadUrlForLayer / BatchGetImage / …
        │    → * (needed to authenticate; scoped by the ECR resource policy in pg)
        │
        └─ logs:CreateLogGroup / CreateLogStream / PutLogEvents
             → arn:aws:logs:eu-west-1:944945738260:*
```

### Key design decisions

**No AgentCore Gateway.** The original plan used an AgentCore Gateway to proxy Datadog MCP calls, with an interceptor Lambda injecting credentials. This failed because the gateway calls the MCP endpoint during target registration (tool discovery) without invoking the interceptor. Datadog requires auth on every call including discovery, so the target always stayed in FAILED state. The Python container fetches credentials itself from Secrets Manager instead.

**Cross-account ECR.** An org-level SCP (`p-n94gdmkj`) blocks `ecr:CreateRepository` in cko-gen3-qa. The image lives in cko-gen3-pg with a repository resource policy that allows the qa runtime role to pull it. No code change needed; ECR cross-account pull is transparent to the container runtime.

**Hand-rolled SigV4 in .NET.** There is no `AWSSDK.BedrockAgentCore` NuGet package. `AgentRuntimeService.cs` implements SigV4 manually. The critical non-obvious detail: the canonical URI must replicate Python botocore's `quote(normalize_url_path(path), safe='/~')`, which double-encodes percent-encoded characters already in the path. Failure to do this produces a 403 because the signature doesn't match.

**Inference profiles, not model IDs.** The `cko-gen3-qa` account uses cross-region inference profiles (`eu.anthropic.*`) for all Claude models. Raw model IDs fail with "on-demand throughput not supported". Use `aws bedrock list-inference-profiles` to find what is ACTIVE in the account.

---

## Accounts and region

| Purpose | Account | Account ID |
|---|---|---|
| Application workload | cko-gen3-qa | 944945738260 |
| ECR image registry | cko-gen3-pg | 101852531977 |

Region: `eu-west-1` throughout.

---

## Prerequisites

- AWS CLI authenticated for both accounts:
  ```bash
  aws sts get-caller-identity --profile cko-gen3-qa
  aws sts get-caller-identity --profile cko-gen3-pg
  ```
- Docker Desktop installed and running (`docker info` should not error)
- Python 3.10+ with `pip`
- .NET 8 SDK

Set these shell variables before running any command in this guide:

```bash
export QA_PROFILE=cko-gen3-qa
export PG_PROFILE=cko-gen3-pg
export QA_ACCOUNT=944945738260
export PG_ACCOUNT=101852531977
export REGION=eu-west-1
```

---

## Step 1 — Secrets Manager: store Datadog credentials

The Python container will read two separate secrets at runtime.

```bash
# API key secret
aws secretsmanager create-secret \
  --profile $QA_PROFILE \
  --region $REGION \
  --name "due-diligence/logs-teller-agent/dd-api-key" \
  --secret-string "<your-datadog-api-key>"

# App key secret
aws secretsmanager create-secret \
  --profile $QA_PROFILE \
  --region $REGION \
  --name "due-diligence/logs-teller-agent/dd-app-key" \
  --secret-string "<your-datadog-app-key>"
```

> **Why two secrets instead of one?** The runtime fetches them with `GetSecretValue`. Keeping them separate makes rotation and key scoping easier. If you want to use one JSON secret, update the `_get_dd_headers()` function in `agent_runtime.py` accordingly.

---

## Step 2 — IAM: execution role for the AgentCore Runtime

The container runs with this role. It needs to call Bedrock (for Claude) and Secrets Manager (for Datadog credentials).

### 2a — Create the trust policy

```bash
cat > /tmp/runtime-trust.json << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Service": "bedrock-agentcore.amazonaws.com" },
    "Action": "sts:AssumeRole"
  }]
}
EOF

aws iam create-role \
  --profile $QA_PROFILE \
  --role-name "due-diligence-logs-teller-runtime-role" \
  --assume-role-policy-document file:///tmp/runtime-trust.json
```

Note the `Arn` — you need it in Step 5.

### 2b — Attach the permission policy

This policy covers:
- Calling Bedrock models and cross-region inference profiles
- Reading the Datadog secrets
- Pulling the container image from ECR (cross-account)
- Writing CloudWatch logs

```bash
cat > /tmp/runtime-policy.json << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "BedrockModel",
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream",
        "bedrock:InvokeModelWithResponseStream"
      ],
      "Resource": [
        "arn:aws:bedrock:eu-west-1::foundation-model/*",
        "arn:aws:bedrock:eu-west-1:944945738260:inference-profile/*",
        "arn:aws:bedrock:eu-west-1::inference-profile/*"
      ]
    },
    {
      "Sid": "SecretsManager",
      "Effect": "Allow",
      "Action": "secretsmanager:GetSecretValue",
      "Resource": [
        "arn:aws:secretsmanager:eu-west-1:944945738260:secret:due-diligence/logs-teller-agent/*"
      ]
    },
    {
      "Sid": "ECRPull",
      "Effect": "Allow",
      "Action": [
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage",
        "ecr:GetAuthorizationToken",
        "ecr:BatchCheckLayerAvailability"
      ],
      "Resource": "*"
    },
    {
      "Sid": "Logs",
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:eu-west-1:944945738260:*"
    }
  ]
}
EOF

aws iam put-role-policy \
  --profile $QA_PROFILE \
  --role-name "due-diligence-logs-teller-runtime-role" \
  --policy-name "due-diligence-logs-teller-runtime-policy" \
  --policy-document file:///tmp/runtime-policy.json
```

> **Why does the inference-profile ARN appear twice?** AWS has two ARN formats for inference profiles: account-scoped (`arn:aws:bedrock:region:account-id:inference-profile/...`) and non-account-scoped (`arn:aws:bedrock:region::inference-profile/...`). Both are needed because which form a specific model uses is not consistent. If you get `AccessDeniedException` on the Bedrock call, re-read the error message — it will show you which ARN format is needed.

---

## Step 3 — ECR: create the image repository (in cko-gen3-pg)

The org-level SCP (`p-n94gdmkj`) blocks `ecr:CreateRepository` in the qa account. The image lives in cko-gen3-pg instead, with a resource-based policy that allows the qa runtime role to pull it.

### 3a — Create the repo in pg

```bash
aws ecr create-repository \
  --profile $PG_PROFILE \
  --region $REGION \
  --repository-name "bedrock-agentcore-due_diligence_logs_teller_agentruntime"
```

### 3b — Allow the qa runtime role to pull

```bash
aws ecr set-repository-policy \
  --profile $PG_PROFILE \
  --region $REGION \
  --repository-name "bedrock-agentcore-due_diligence_logs_teller_agentruntime" \
  --policy-text '{
    "Version": "2012-10-17",
    "Statement": [{
      "Sid": "AllowQARuntimePull",
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::944945738260:role/due-diligence-logs-teller-runtime-role"
      },
      "Action": [
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage",
        "ecr:BatchCheckLayerAvailability"
      ]
    }]
  }'
```

---

## Step 4 — Build and push the Docker image

The image must be ARM64 (AgentCore Runtime requires it).

```bash
cd agentcore

# Authenticate Docker with the pg ECR
aws ecr get-login-password --profile $PG_PROFILE --region $REGION \
  | docker login --username AWS --password-stdin \
    ${PG_ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com

# Build for ARM64
docker build \
  --platform linux/arm64 \
  -t ${PG_ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com/bedrock-agentcore-due_diligence_logs_teller_agentruntime:latest \
  .

# Push
docker push \
  ${PG_ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com/bedrock-agentcore-due_diligence_logs_teller_agentruntime:latest
```

This takes 3–5 minutes on the first run (installing Python packages into the image layer).

---

## Step 5 — Create the AgentCore Runtime

This registers the container as an AgentCore Runtime. The name must match the regex `[a-zA-Z][a-zA-Z0-9_]{0,47}` — underscores are allowed, hyphens are not.

```bash
RUNTIME_ROLE_ARN=$(aws iam get-role \
  --profile $QA_PROFILE \
  --role-name due-diligence-logs-teller-runtime-role \
  --query Role.Arn --output text)

aws bedrock-agentcore create-agent-runtime \
  --profile $QA_PROFILE \
  --region $REGION \
  --agent-runtime-name "due_diligence_logs_teller_agentruntime" \
  --agent-runtime-artifact '{
    "containerConfiguration": {
      "containerUri": "101852531977.dkr.ecr.eu-west-1.amazonaws.com/bedrock-agentcore-due_diligence_logs_teller_agentruntime:latest"
    }
  }' \
  --role-arn "$RUNTIME_ROLE_ARN" \
  --network-configuration '{"networkMode": "PUBLIC"}' \
  --environment-variables '{
    "DD_API_KEY_SECRET": "due-diligence/logs-teller-agent/dd-api-key",
    "DD_APP_KEY_SECRET": "due-diligence/logs-teller-agent/dd-app-key",
    "DD_MCP_URL": "https://mcp.datadoghq.eu/api/unstable/mcp-server/mcp",
    "AWS_REGION": "eu-west-1",
    "AWS_DEFAULT_REGION": "eu-west-1",
    "MODEL_ID": "eu.anthropic.claude-sonnet-4-5-20250929-v1:0"
  }'
```

> **CLI version note:** The `bedrock-agentcore` CLI commands require a recent AWS CLI. If you get "Invalid choice: bedrock-agentcore", run `pip install --upgrade awscli`. The control-plane operations (`create-agent-runtime`, `update-agent-runtime`) are under `bedrock-agentcore-control` in some SDK versions and `bedrock-agentcore` in others — check with `aws bedrock-agentcore help`.

Poll until the runtime is READY:

```bash
while true; do
  STATUS=$(aws bedrock-agentcore get-agent-runtime \
    --profile $QA_PROFILE \
    --region $REGION \
    --agent-runtime-id "due_diligence_logs_teller_agentruntime-<suffix>" \
    --query status --output text)
  echo "Status: $STATUS"
  [[ "$STATUS" == "READY" || "$STATUS" == *"FAILED"* ]] && break
  sleep 15
done
```

Copy the `agentRuntimeArn` from the output — you need it in Step 7.

---

## Step 6 — Updating the runtime (if you need to redeploy)

If `agent_runtime.py` changes, rebuild and push the image (Step 4 again), then update the runtime:

```python
# update_runtime.py — run with: AWS_PROFILE=cko-gen3-qa python update_runtime.py
import boto3, time

client = boto3.Session(profile_name='cko-gen3-qa').client('bedrock-agentcore-control', region_name='eu-west-1')

client.update_agent_runtime(
    agentRuntimeId='due_diligence_logs_teller_agentruntime-<suffix>',
    roleArn='arn:aws:iam::944945738260:role/due-diligence-logs-teller-runtime-role',
    networkConfiguration={'networkMode': 'PUBLIC'},
    agentRuntimeArtifact={
        'containerConfiguration': {
            'containerUri': '101852531977.dkr.ecr.eu-west-1.amazonaws.com/bedrock-agentcore-due_diligence_logs_teller_agentruntime:latest'
        }
    },
    environmentVariables={
        'DD_API_KEY_SECRET': 'due-diligence/logs-teller-agent/dd-api-key',
        'DD_APP_KEY_SECRET': 'due-diligence/logs-teller-agent/dd-app-key',
        'DD_MCP_URL': 'https://mcp.datadoghq.eu/api/unstable/mcp-server/mcp',
        'AWS_REGION': 'eu-west-1',
        'AWS_DEFAULT_REGION': 'eu-west-1',
        'MODEL_ID': 'eu.anthropic.claude-sonnet-4-5-20250929-v1:0',
    }
)

# Poll
for _ in range(20):
    time.sleep(15)
    resp = client.get_agent_runtime(agentRuntimeId='due_diligence_logs_teller_agentruntime-<suffix>')
    status = resp.get('status')
    print('Status:', status)
    if status in {'READY', 'UPDATE_FAILED'}:
        break
```

---

## Step 7 — Configure the .NET API

In `api/appsettings.json`:

```json
"Bedrock": {
  "Region": "eu-west-1",
  "Profile": "cko-gen3-qa",
  "AgentRuntimeArn": "arn:aws:bedrock-agentcore:eu-west-1:944945738260:runtime/due_diligence_logs_teller_agentruntime-<suffix>"
}
```

`Profile` is only read on local developer machines. In deployed environments, remove it — the app will use the instance role automatically.

The runtime ARN is consumed by `AgentRuntimeService.cs` in the `api/Services/` directory. No other code changes are needed when redeploying the container.

---

## Step 8 — Smoke test

### Python (direct boto3)

```python
import boto3, json

client = boto3.Session(profile_name='cko-gen3-qa').client('bedrock-agentcore', region_name='eu-west-1')
resp = client.invoke_agent_runtime(
    agentRuntimeArn='arn:aws:bedrock-agentcore:eu-west-1:944945738260:runtime/due_diligence_logs_teller_agentruntime-<suffix>',
    qualifier='DEFAULT',
    payload=json.dumps({'prompt': 'What happened in due-diligence-pep-case-notifier in the last 2 hours?'}).encode()
)
for line in resp['response'].iter_lines():
    if line:
        print(line.decode())
```

Expect 300–600 words of plain-English chronicle after 30–60 seconds.

### .NET API

Start the API (`dotnet run --project api/`) then:

```bash
curl -X POST http://localhost:5000/agent-chronicle/generate \
  -H "Content-Type: application/json" \
  -d '{"prompt": "What happened in due-diligence-pep-case-notifier Lambda in the last 2 hours?"}'
```

A 200 response with a `narrative` string means the full chain is working.

---

## Component reference

### agentcore/agent_runtime.py

The Python agent. Key design decisions:
- Calls Datadog MCP directly (not via AgentCore Gateway) — see the issues doc for why
- Fetches credentials from Secrets Manager at first invocation; cached for the container lifetime
- Uses `BedrockAgentCoreApp` from the `bedrock-agentcore` package as the process entrypoint
- Model: cross-region inference profile (`eu.anthropic.claude-sonnet-4-5-20250929-v1:0`)

If you change the model: check `aws bedrock list-inference-profiles --profile cko-gen3-qa --region eu-west-1` for ACTIVE profiles, then update the runtime env var `MODEL_ID` (no image rebuild needed — just `update_agent_runtime`).

### api/Services/AgentRuntimeService.cs

The .NET side. Key design decisions:
- No `AWSSDK.BedrockAgentCore` package exists, so it hand-rolls SigV4
- The SigV4 canonical URI uses `BotocoreCanonicalUri()` which replicates Python botocore's `quote(normalize_url_path(path), safe='/~')` — this double-encodes percent-encoded characters (`%3A` → `%253A`) to match what the AWS server expects
- Session ID is sent as `X-Amzn-Bedrock-AgentCore-Runtime-Session-Id` header (not in the body)
- Signed headers: `host`, `x-amz-date`, `x-amz-security-token`, `x-amzn-bedrock-agentcore-runtime-session-id` — exactly matching boto3's SignedHeaders

### Choosing the Bedrock model

Use a cross-region inference profile, not a raw model ID. Only inference profiles work with this account:

```bash
aws bedrock list-inference-profiles \
  --profile cko-gen3-qa \
  --region eu-west-1 \
  --query 'inferenceProfileSummaries[?status==`ACTIVE` && contains(inferenceProfileId,`claude`)].[inferenceProfileId]' \
  --output text
```

Current choice: `eu.anthropic.claude-sonnet-4-5-20250929-v1:0` (Claude Sonnet 4.5, cross-region EU).

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `403 Forbidden` from .NET | SigV4 signing error | Check `AgentRuntimeService.cs` — `BotocoreCanonicalUri` must double-encode `%3A`/`%2F` |
| `AccessDeniedException: inference-profile` | IAM policy missing inference-profile ARN | Add `arn:aws:bedrock:eu-west-1:<account>:inference-profile/*` to the Bedrock resource list |
| `AccessDeniedException: aws-marketplace` | Model not subscribed in Bedrock console | Use a different inference profile (e.g. claude-sonnet-4-5) or enable model access in the console |
| `ResourceNotFoundException` | Wrong ARN or runtime not READY | Verify ARN in appsettings.json; poll `get-agent-runtime` status |
| Container startup error | Python import failure | Check CloudWatch log group `/aws/bedrock-agentcore/runtime/<id>` |
| `MCPClientInitializationError` | Datadog MCP auth failure | Verify the two Secrets Manager secrets exist and contain valid DD keys; test with: `aws secretsmanager get-secret-value --secret-id due-diligence/logs-teller-agent/dd-api-key` |
| Empty chronicle / "no logs found" | Wrong Datadog service name or time range | Try a broader query; confirm service name matches Datadog's `service` tag exactly |
| Architecture incompatible error on create-agent-runtime | Image built for AMD64 | Rebuild with `--platform linux/arm64` |
