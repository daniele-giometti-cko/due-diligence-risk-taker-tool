# Track B — AWS AgentCore Setup

**Account:** `944945738260` (cko-gen3-qa)  
**Region:** `eu-west-1` (unless noted)  
**Goal:** Wire Datadog MCP into a Bedrock Agent via AgentCore Gateway so the .NET tool can call `InvokeAgent` and get Datadog log summaries.

---

## Prerequisites

- AWS CLI authenticated against cko-gen3-qa: `aws sts get-caller-identity --profile cko-gen3-qa`
- AppKey `risk-assessment-agent` in hand (you have this now)
- API key pending — create a placeholder slot in Secrets Manager today; fill it Monday

Set these shell variables before running any command below:

```bash
export AWS_PROFILE=cko-gen3-qa
export ACCOUNT_ID=$(aws sts get-caller-identity --profile cko-gen3-qa --query Account --output text)
export REGION=eu-west-1
```

---

## Step 1 — Secrets Manager: store Datadog credentials ✅ Done

> **Already completed** for `cko-gen3-qa`. The secret is live at:
> - **Name:** `due-diligence/logs-teller-agent`
> - **Keys:** `LogsTeller:ApiKey` (API key — pending), `LogsTeller:AppKey` (App key `risk-assessment-agent`)
>
> When you have the API key, update it with:
> ```bash
> aws secretsmanager put-secret-value \
>   --profile cko-gen3-qa \
>   --region eu-west-1 \
>   --secret-id "due-diligence/logs-teller-agent" \
>   --secret-string '{
>     "LogsTeller:AppKey": "<your-app-key-here>",
>     "LogsTeller:ApiKey": "<your-api-key-here>"
>   }'
> ```

**Why one secret for both?** `GetSecretValue` is a single IAM action. Keeping them together means one permission, one call. The colon in `LogsTeller:ApiKey` is a valid JSON key — .NET's `JsonDocument`/`GetProperty` handles it fine; just quote it when accessing the value.

---

## Step 2 — IAM: execution role for the Bedrock Agent

The Bedrock Agent needs a role it can assume. The role must allow:
- Bedrock to assume it (trust policy)
- The agent to read the secret you just created
- The agent to invoke Bedrock models during reasoning

### 2a — Create the trust policy document

Save this as `/tmp/agent-trust.json`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "bedrock.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

### 2b — Create the role

```bash
aws iam create-role \
  --profile cko-gen3-qa \
  --role-name "due-diligence-logs-teller-agent-role" \
  --assume-role-policy-document file:///tmp/agent-trust.json \
  --description "Execution role for the Due Diligence Agentic - Logs Teller Bedrock Agent"
```

Note the `Arn` in the output — you will need it in Step 3.

### 2c — Attach permissions inline

Save this as `/tmp/agent-policy.json`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadDatadogCredentials",
      "Effect": "Allow",
      "Action": "secretsmanager:GetSecretValue",
      "Resource": "arn:aws:secretsmanager:eu-west-1:944945738260:secret:due-diligence/logs-teller-agent*"
    },
    {
      "Sid": "InvokeBedrockModel",
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream"
      ],
      "Resource": "arn:aws:bedrock:eu-west-1::foundation-model/anthropic.claude-3-5-sonnet-20241022-v2:0"
    },
    {
      "Sid": "AgentCoreGateway",
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeAgent",
        "bedrock-agentcore:*"
      ],
      "Resource": "*"
    }
  ]
}
```

```bash
aws iam put-role-policy \
  --profile cko-gen3-qa \
  --role-name "due-diligence-logs-teller-agent-role" \
  --policy-name "due-diligence-logs-teller-agent-policy" \
  --policy-document file:///tmp/agent-policy.json
```

**Learning note:** The `bedrock-agentcore:*` is broad for experimentation. In production you would scope it to specific gateway ARNs.

---

## Step 3 — Bedrock Agent: create the agent

The agent is the orchestrator — it holds the system prompt and decides which tools (via AgentCore Gateway) to call.

### 3a — Create the agent

```bash
aws bedrock-agent create-agent \
  --profile cko-gen3-qa \
  --region eu-west-1 \
  --agent-name "due-diligence-logs-teller-agent" \
  --agent-resource-role-arn "arn:aws:iam::944945738260:role/due-diligence-logs-teller-agent-role" \
  --foundation-model "anthropic.claude-3-5-sonnet-20241022-v2:0" \
  --instruction "You are a Due Diligence platform analyst at Checkout.com. \
You have access to Datadog log search tools. \
When given a natural language request about what happened in a service, \
you query Datadog for relevant log events, then write a concise plain-English \
chronicle (under 400 words, past tense) describing the sequence of events, \
any errors, and the overall outcome. \
Never expose raw log payloads. Summarise counts and patterns instead. \
Always state the time window and service you queried."
```

Note the `agentId` in the response.

### 3b — Create an agent alias (needed for InvokeAgent)

```bash
aws bedrock-agent create-agent-alias \
  --profile cko-gen3-qa \
  --region eu-west-1 \
  --agent-id "<agentId-from-above>" \
  --agent-alias-name "live"
```

Note `agentAliasId` — your .NET `BedrockAgentService` will use `agentId` + `agentAliasId` together.

---

## Step 4 — AgentCore Gateway: create the gateway

The gateway is the managed MCP proxy. It sits between your Bedrock Agent and the Datadog MCP server. It handles OAuth, tool discovery, and request forwarding.

```bash
aws bedrock-agentcore create-gateway \
  --profile cko-gen3-qa \
  --region eu-west-1 \
  --name "due-diligence-logs-teller-gateway" \
  --description "Proxies Datadog MCP for the Due Diligence chronicle agent" \
  --role-arn "arn:aws:iam::944945738260:role/due-diligence-logs-teller-agent-role"
```

Note the `gatewayId` and `gatewayArn`.

> **Recorded values:**
> - `gatewayId`: `due-diligence-logs-teller-gateway-wdp7kudkue`
> - `gatewayArn`: `arn:aws:bedrock-agentcore:eu-west-1:944945738260:gateway/due-diligence-logs-teller-gateway-wdp7kudkue`
> - `gatewayUrl`: `https://due-diligence-logs-teller-gateway-wdp7kudkue.gateway.bedrock-agentcore.eu-west-1.amazonaws.com/mcp`
> - `interceptorLambdaArn`: `arn:aws:lambda:eu-west-1:944945738260:function:due-diligence-logs-teller-interceptor`
> - `targetId`: `7BQCAWOUVZ`

**Why a separate gateway?** The gateway is reusable — other agents or services in the same account can point to it. It also insulates your agent from MCP endpoint changes.

---

## Step 5 — AgentCore Gateway: register the Datadog MCP target

This tells the gateway where the Datadog MCP server lives and how to authenticate.

The Datadog MCP server at `mcp.datadoghq.eu` uses API key + App key header authentication, not standard OAuth PKCE flow. Configure it as an HTTP target with credential injection:

```bash
aws bedrock-agentcore create-gateway-target \
  --profile cko-gen3-qa \
  --region eu-west-1 \
  --gateway-id "<gatewayId-from-above>" \
  --name "datadog-mcp-eu" \
  --endpoint-configuration '{
    "mcpProxy": {
      "url": "https://mcp.datadoghq.eu/api/unstable/mcp-server/mcp",
      "credentialConfiguration": {
        "credentialProviderType": "GATEWAY_IAM_ROLE",
        "additionalHeaders": {
          "DD-API-KEY": "{{resolve:secretsmanager:due-diligence/logs-teller-agent:SecretString:LogsTeller:ApiKey}}",
          "DD-APPLICATION-KEY": "{{resolve:secretsmanager:due-diligence/logs-teller-agent:SecretString:LogsTeller:AppKey}}"
        }
      }
    }
  }'
```

**Important:** AgentCore is a newer service — check the exact parameter names against the current SDK docs if the CLI rejects the shape above. The console UI may be easier for the first attempt.

---

## Architecture note: Classic Bedrock Agent vs AgentCore Runtime

> **Discovery:** Classic Bedrock Agents (`bedrock-agent`, `InvokeAgent`) and AgentCore Agents (`bedrock-agentcore`, `invoke_agent_runtime`) are **separate frameworks**. Classic agents only support Lambda action groups or API Gateway — they cannot use an AgentCore Gateway as a tool executor. 
>
> **Chosen path:** Deploy a **Python AgentCore Runtime** container (Strands + `BedrockAgentCoreApp`) that calls the AgentCore Gateway. The .NET API calls this runtime via raw HTTP + SigV4 (`AgentRuntimeService.cs`).
>
> The Classic Bedrock Agent created in Step 3 (`U9THU64OH7`) is **unused** in the final architecture.

---

## Step 6 — Deploy the AgentCore Runtime (Python container)

The Python agent lives in `agentcore/`. It uses [Strands Agents SDK](https://github.com/strands-agents/sdk-python) and connects to the AgentCore Gateway via SigV4-signed MCP calls.

### 6a — IAM execution role for the runtime

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
  --profile cko-gen3-qa \
  --role-name "due-diligence-logs-teller-runtime-role" \
  --assume-role-policy-document file:///tmp/runtime-trust.json

cat > /tmp/runtime-policy.json << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "BedrockModel",
      "Effect": "Allow",
      "Action": ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
      "Resource": "arn:aws:bedrock:eu-west-1::foundation-model/anthropic.claude-3-5-sonnet-20241022-v2:0"
    },
    {
      "Sid": "GatewayCall",
      "Effect": "Allow",
      "Action": "bedrock-agentcore:InvokeGateway",
      "Resource": "arn:aws:bedrock-agentcore:eu-west-1:944945738260:gateway/due-diligence-logs-teller-gateway-wdp7kudkue"
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
      "Action": ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"],
      "Resource": "arn:aws:logs:eu-west-1:944945738260:*"
    }
  ]
}
EOF

aws iam put-role-policy \
  --profile cko-gen3-qa \
  --role-name "due-diligence-logs-teller-runtime-role" \
  --policy-name "due-diligence-logs-teller-runtime-policy" \
  --policy-document file:///tmp/runtime-policy.json
```

Note the role ARN — you need it in the next step.

### 6b — Deploy via the starter toolkit

The deploy script handles Docker build, ECR push, and `create_agent_runtime` automatically:

```bash
cd agentcore

# Install toolkit (first time only)
pip install bedrock-agentcore-starter-toolkit

# Deploy (takes 5–10 min — Docker build + ECR push + container start)
AWS_PROFILE=cko-gen3-qa python deploy.py \
  --role-arn "arn:aws:iam::944945738260:role/due-diligence-logs-teller-runtime-role"
```

When it prints `agentRuntimeArn: arn:aws:...`, copy that value into `api/appsettings.json`:

```json
"Bedrock": {
  "AgentRuntimeArn": "arn:aws:bedrock-agentcore:eu-west-1:944945738260:agentRuntime/..."
}
```

> **Recorded values:**
> - `agentRuntimeArn`: *(fill in after deploy)*

---

## Step 7 — Smoke test

### 7a — CLI smoke test via boto3

```python
import boto3, json

client = boto3.client("bedrock-agentcore", region_name="eu-west-1")
resp = client.invoke_agent_runtime(
    agentRuntimeArn="<agentRuntimeArn>",
    qualifier="DEFAULT",
    payload=json.dumps({"prompt": "What happened in due-diligence-pep-case-notifier in the last 2 hours?"})
)
for line in resp["response"].iter_lines():
    if line:
        print(line.decode())
```

### 7b — .NET API smoke test

```bash
curl -X POST http://localhost:5000/agent-chronicle/generate \
  -H "Content-Type: application/json" \
  -d '{"prompt": "What happened in due-diligence-pep-case-notifier Lambda in the last 2 hours?"}'
```

A successful response means the full chain works:
`.NET → AgentRuntime → Gateway → Datadog MCP → logs → chronicle`

---

## Configuration values to collect

After completing these steps, record these values in `api/appsettings.json`:

| Key | Where to find it |
|---|---|
| `Bedrock:AgentRuntimeArn` | Step 6b deploy output |
| `Bedrock:Region` | `eu-west-1` |
| `Bedrock:Profile` | `cko-gen3-qa` (local dev only) |

---

## Sequence diagram (what you just built)

```
.NET AgentChronicleController
    │
    ▼
AgentRuntimeService.InvokeAsync(prompt)   ← raw HTTP + SigV4
    │   POST /runtimes/{arn}/invocations
    ▼
AgentCore Runtime (Python container)
    │   Strands + BedrockAgentCoreApp
    │   model: claude-3-5-sonnet
    ▼
MCPClient → AgentCore Gateway  ← SigV4 from runtime IAM role
    │   interceptor Lambda injects DD-API-KEY + DD-APPLICATION-KEY
    ▼
Datadog MCP Server (mcp.datadoghq.eu)
    │   runs log search
    ▼
Returns log events to Strands Agent
    │
    ▼
Agent writes chronicle narrative (streamed via SSE)
    │
    ▼
.NET receives full text response
```

---

## Troubleshooting checklist

- **`ResourceNotFoundException` on runtime invoke** — wrong ARN or runtime not READY yet
- **Gateway target auth failures** — Secrets Manager ARN typo, or secret not in same region as gateway
- **MCP tool not discovered** — gateway target registration incomplete; check `list-gateway-targets`
- **`bedrock-agentcore` CLI commands not found** — CLI version too old; run `pip install --upgrade awscli`
- **Container startup fails** — check CloudWatch log group `/aws/bedrock-agentcore/runtime/<id>` for Python errors
- **SigV4 signature mismatch from Python** — ensure the container's IAM role has `bedrock-agentcore:InvokeGateway` and the runtime role ARN matches the gateway's resource policy
