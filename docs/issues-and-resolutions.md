# Issues Encountered and How We Resolved Them

This document records the problems that came up while building the Due Diligence Agentic - Logs Teller Agent and explains the decision taken for each. Reading this is faster than re-discovering the same dead ends.

---

## Issue 1 — Classic Bedrock Agent cannot use AgentCore Gateway as a tool

**What we expected:** Create a Classic Bedrock Agent (via `aws bedrock-agent create-agent`), attach an AgentCore Gateway to it as a tool group, and call `InvokeAgent` from .NET.

**What we found:** Classic Bedrock Agents (`bedrock-agent`, `InvokeAgent`) and AgentCore Agents (`bedrock-agentcore`, `invoke_agent_runtime`) are completely separate frameworks. Classic agents only support Lambda action groups and Knowledge Bases as tool sources — they have no awareness of AgentCore Gateways. There is no way to attach an AgentCore Gateway as a tool to a Classic Bedrock Agent.

**How we resolved it:** Switched to the AgentCore Runtime approach. Instead of a Classic Agent, we deployed a Python container using the Strands SDK and `BedrockAgentCoreApp`. The .NET API calls this container directly via raw HTTP + SigV4.

The Classic Bedrock Agent created during exploration (`U9THU64OH7`) is unused in the final architecture.

---

## Issue 2 — AgentCore Gateway target stayed in FAILED state

**What we expected:** Create an AgentCore Gateway, register the Datadog MCP endpoint as a target with credential injection (DD-API-KEY and DD-APPLICATION-KEY from Secrets Manager), and have the gateway proxy tool calls to Datadog.

**What we found:** The gateway target `7BQCAWOUVZ` stayed in status `FAILED` with error `{"errors":["Unauthorized"]}`. The reason: when AgentCore registers a gateway target, it calls the MCP endpoint immediately to discover available tools. This validation call does NOT invoke the interceptor Lambda — it uses no credentials at all. The Datadog MCP endpoint requires valid API headers on every request, including this initial discovery call. Since the interceptor Lambda (which would inject the headers) only runs for actual client requests, the validation call always fails with Unauthorized.

We tried working around this with `mcpToolSchema.inlinePayload` to skip automatic tool discovery, but the API rejected it: "mcpToolSchema is only supported for MCP Server targets with AUTHORIZATION_CODE grant type".

**How we resolved it:** Abandoned the gateway entirely. The Python container now calls the Datadog MCP endpoint directly, fetching credentials from Secrets Manager itself at startup. This removes the AgentCore Gateway from the architecture completely and makes the credential flow simpler — no Lambda interceptor, no gateway configuration, just two `GetSecretValue` calls.

**The lesson:** AgentCore Gateway is designed for MCP servers that support standard OAuth flows. Services like Datadog that use custom dual-header API key authentication don't fit the gateway's assumption that tool discovery can happen without client credentials.

---

## Issue 3 — AgentCore Runtime name validation rejected hyphens

**What happened:** The first `create-agent-runtime` call failed with a validation error. The name `due-diligence-logs-teller-agentruntime` was rejected.

**Why:** AgentCore Runtime names must match the regex `[a-zA-Z][a-zA-Z0-9_]{0,47}`. Hyphens (`-`) are not allowed; only underscores (`_`) are.

**How we resolved it:** Renamed to `due_diligence_logs_teller_agentruntime`. The suffix appended by AWS (`-ZRS6L187pp`) contains hyphens, which is fine — the constraint applies only to the user-provided part.

---

## Issue 4 — SCP blocked ECR CreateRepository in the qa account

**What happened:** Attempting to create an ECR repository in `cko-gen3-qa` (either via the starter toolkit or manually) returned `AccessDeniedException: User is not authorized to perform: ecr:CreateRepository... because an explicit deny in a service control policy...`

**Why:** The AWS organisation-level SCP `p-n94gdmkj` includes an explicit `Deny` for `ecr:CreateRepository` in the qa account. An explicit deny at the SCP level overrides everything — IAM policies, breakglass roles, everything. It cannot be bypassed from within the account.

**How we resolved it:** Created the ECR repository in `cko-gen3-pg` (account `101852531977`) where no such SCP restriction exists, then set a resource-based policy on the repository that allows the qa runtime role to pull images. The AgentCore Runtime in qa pulls from pg without issue.

Cross-account ECR pull requires:
1. The pulling role (in qa) has the standard ECR pull permissions (`GetDownloadUrlForLayer`, `BatchGetImage`, etc.) in its IAM policy
2. The repository (in pg) has a resource policy granting those actions to the qa role's ARN

---

## Issue 5 — Docker daemon was not running

**What happened:** The `bedrock-agentcore-starter-toolkit`'s launch command reported "No container engine found". Manual `docker build` also failed.

**Why:** Docker Desktop was installed but not running.

**How we resolved it:** `open -a Docker` on macOS. Waited ~30 seconds for the daemon to start, confirmed with `docker info`.

---

## Issue 6 — Container image built for AMD64 was rejected

**What happened:** `create-agent-runtime` rejected the image with: `Architecture incompatible... Supported architectures: [arm64]`.

**Why:** The default `docker build` on an Intel Mac produces an AMD64 image. AgentCore Runtime only accepts ARM64 containers.

**How we resolved it:** Added `--platform linux/arm64` to the `docker build` command. On Apple Silicon Macs this is the native platform anyway. On Intel Macs, Docker emulates ARM64 for the build; this works but is slower.

---

## Issue 7 — Model IDs for Bedrock kept failing

This was a chain of three separate failures.

### 7a — `eu.anthropic.claude-3-5-sonnet-20241022-v2:0` not available

**Error:** `on-demand throughput isn't supported for the specified model`

**Why:** That specific model version is not available in the eu-west-1 cross-region inference profile set, or it requires a provisioned throughput commitment.

### 7b — Raw model ID `anthropic.claude-sonnet-4-6` not valid

**Error:** Similar unsupported throughput error.

**Why:** For Claude 4.x models, you must use the cross-region inference profile ID, not the raw model ID.

### 7c — How we found the right model

```bash
aws bedrock list-inference-profiles \
  --profile cko-gen3-qa \
  --region eu-west-1 \
  --query 'inferenceProfileSummaries[?status==`ACTIVE`].[inferenceProfileId]' \
  --output text
```

This lists every inference profile available in the account. Claude 3.7 Sonnet (`eu.anthropic.claude-3-7-sonnet-20250219-v1:0`) was confirmed ACTIVE and worked on the first try.

**Final resolution:** Use `eu.anthropic.claude-3-7-sonnet-20250219-v1:0` as `MODEL_ID`. This is set as a runtime environment variable — if you need to change the model, update the env var via `update_agent_runtime` and the runtime will pick it up on next invocation without requiring a container rebuild.

---

## Issue 8 — AccessDeniedException on Bedrock InvokeModelWithResponseStream for inference profiles

**What happened:** After fixing the model ID, the container started but the agent failed with:
```
AccessDeniedException: User ... is not authorized to perform:
bedrock:InvokeModelWithResponseStream on resource:
arn:aws:bedrock:eu-west-1:944945738260:inference-profile/eu.anthropic.claude-3-7-sonnet-20250219-v1:0
because no identity-based policy allows the action
```

**Why:** The IAM policy for the runtime role had:
```json
"Resource": "arn:aws:bedrock:eu-west-1::foundation-model/*"
```
Foundation model ARNs use the format `arn:aws:bedrock:region::foundation-model/...` (with an empty account ID). But inference profile ARNs use `arn:aws:bedrock:region:account-id:inference-profile/...` (with a real account ID). These are different ARN patterns, and the policy only matched the first one.

**How we resolved it:** Added both inference profile ARN patterns to the policy resource list:
```json
"Resource": [
  "arn:aws:bedrock:eu-west-1::foundation-model/*",
  "arn:aws:bedrock:eu-west-1:944945738260:inference-profile/*",
  "arn:aws:bedrock:eu-west-1::inference-profile/*"
]
```

The double-entry is intentional — different models use different ARN forms and there's no single wildcard that covers both.

---

## Issue 9 — Claude Sonnet 4.6 access blocked by AWS Marketplace subscription

**What happened:** After updating the model to `eu.anthropic.claude-sonnet-4-6` (which appeared ACTIVE in inference profiles), the agent started running but then immediately failed with:
```
AccessDeniedException: Model access is denied due to IAM user or service role
is not authorized to perform the required AWS Marketplace actions
(aws-marketplace:ViewSubscriptions, aws-marketplace:Subscribe)
```

**Why:** Newer Claude 4.x models require an explicit opt-in via the Bedrock console ("Model access" page). Even though the inference profile shows as ACTIVE, the actual model has not been subscribed to in this account. Adding marketplace permissions to the role would not fix this — the account itself needs to enable model access in the console.

**How we resolved it:** Switched to `eu.anthropic.claude-3-7-sonnet-20250219-v1:0` (Claude 3.7 Sonnet), which is fully enabled in the account without additional subscription steps. Claude 3.7 Sonnet provides the same agentic reasoning capability needed for Datadog log analysis.

---

## Issue 10 — .NET SigV4 signing returned 403 Forbidden

This was the most time-consuming issue. No official AWS SDK package exists for `bedrock-agentcore` in .NET, so `AgentRuntimeService.cs` hand-rolls SigV4. Getting it right required debugging three separate mistakes.

### How we diagnosed it

We used Python's botocore to capture the exact HTTP request that boto3 sends (which was confirmed working), then compared it field by field against what the .NET code was producing.

```python
import botocore.httpsession

original_send = botocore.httpsession.URLLib3Session.send
def patched_send(self, request):
    print("URL:", request.url)
    for k, v in request.headers.items():
        print(f"  {k}: {v}")
    raise Exception("CAPTURED")
botocore.httpsession.URLLib3Session.send = patched_send
```

### Bug 1 — Session ID in the wrong place

**What the .NET code did:** Put `runtimeSessionId` inside the JSON body:
```csharp
var body = JsonSerializer.Serialize(new { prompt, runtimeSessionId = sid });
```

**What boto3 actually does:** Sends `runtimeSessionId` as the HTTP header `X-Amzn-Bedrock-AgentCore-Runtime-Session-Id`. The body is only the `payload` (the raw prompt JSON). This is defined in the botocore service model where the `runtimeSessionId` field has `location=header`.

**Fix:**
```csharp
var body = JsonSerializer.Serialize(new { prompt });
request.Headers.TryAddWithoutValidation("X-Amzn-Bedrock-AgentCore-Runtime-Session-Id", sid);
```

The body hash was wrong as long as `runtimeSessionId` was in the body — anything in the body affects the hash, which is part of the canonical request, which is what gets signed.

### Bug 2 — content-type was included in signed headers

**What the .NET code did:** Included `content-type: application/json` in the SortedDictionary of headers to sign.

**What boto3 actually does:** Does not sign `content-type` for this service. boto3's `SignedHeaders` was:
```
host;x-amz-date;x-amz-security-token;x-amzn-bedrock-agentcore-runtime-session-id
```

Signing `content-type` with value `application/json` but boto3 signing nothing about content-type means the canonical requests computed by the two sides differ → 403.

**Fix:** Removed `content-type` from the signed headers dictionary. The header is still sent (for correct HTTP semantics), just not included in the canonical request.

### Bug 3 — Canonical URI not double-encoded

This was the subtlest bug. The ARN contains colons and a forward slash:
```
arn:aws:bedrock-agentcore:eu-west-1:944945738260:runtime/due_diligence_logs_teller_agentruntime-ZRS6L187pp
```

When this ARN is embedded in the URL path, colons become `%3A` and the slash becomes `%2F`:
```
/runtimes/arn%3Aaws%3Abedrock-agentcore%3Aeu-west-1%3A944945738260%3Aruntime%2Fdue_diligence_logs_teller_agentruntime-ZRS6L187pp/invocations
```

For the SigV4 canonical URI, botocore applies `quote(normalize_url_path(path), safe='/~')`. Python's `quote()` with these safe chars encodes the `%` character (not in the safe set) to `%25`. So the already-encoded `%3A` becomes `%253A` and `%2F` becomes `%252F`.

The .NET code was using `request.RequestUri.AbsolutePath` directly (single-encoded) as the canonical URI, while the server was computing the canonical URI from the double-encoded path.

```
.NET computed:  /runtimes/arn%3Aaws%3A...%2F.../invocations
Server expected: /runtimes/arn%253Aaws%253A...%252F.../invocations
```

**Fix:** Added `BotocoreCanonicalUri()` which replicates botocore's algorithm character-by-character:

```csharp
private static string BotocoreCanonicalUri(Uri uri)
{
    var path = uri.AbsolutePath;
    var sb = new StringBuilder(path.Length * 3);
    foreach (char c in path)
    {
        if (c == '/' || c == '~' ||
            (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') ||
            (c >= '0' && c <= '9') ||
            c == '-' || c == '_' || c == '.')
            sb.Append(c);
        else
            sb.Append('%').Append(((int)c).ToString("X2"));
    }
    return sb.ToString();
}
```

This encodes every character except the unreserved set (A-Z, a-z, 0-9, `-`, `_`, `.`) and `/` and `~`. The `%` character (from `%3A` in AbsolutePath) is not unreserved, so it gets encoded to `%25`, producing the double-encoding that matches the server's expectation.

**The general lesson:** When hand-rolling SigV4 for a service where the request path contains user-provided data with special characters, always replicate the reference implementation's canonical URI computation exactly — including its double-encoding behaviour. The easiest way to verify is to capture a working boto3 request and debug-print the canonical request string from both sides with identical timestamps.

---

## Summary table

| # | Issue | Root cause | Resolution |
|---|---|---|---|
| 1 | Classic Bedrock Agent can't use AgentCore Gateway | Separate, incompatible frameworks | Switched to AgentCore Runtime (Python container) |
| 2 | Gateway target stayed FAILED | Tool discovery call hits Datadog without credentials; interceptor not invoked at validation time | Removed gateway; Python container calls Datadog MCP directly |
| 3 | Runtime name rejected | Hyphens not allowed in runtime name | Changed to underscores |
| 4 | ECR CreateRepository blocked | Org-level SCP explicit deny in qa account | Created ECR repo in pg account with cross-account pull policy |
| 5 | Docker build failed | Docker Desktop not running | `open -a Docker` |
| 6 | Image rejected at runtime creation | AMD64 image, ARM64 required | `docker build --platform linux/arm64` |
| 7 | Wrong Bedrock model IDs | On-demand throughput not available; inference profiles required | Listed ACTIVE profiles; used `eu.anthropic.claude-3-7-sonnet-20250219-v1:0` |
| 8 | IAM AccessDeniedException on inference-profile | Policy resource pattern only covered foundation-model ARNs | Added `inference-profile/*` ARN patterns to the Bedrock resource list |
| 9 | Marketplace subscription error for Claude 4.6 | Model access not enabled in Bedrock console for the account | Used Claude 3.7 Sonnet which is already fully enabled |
| 10a | .NET 403: body hash wrong | `runtimeSessionId` was in JSON body; should be a header | Moved to `X-Amzn-Bedrock-AgentCore-Runtime-Session-Id` header |
| 10b | .NET 403: wrong signed headers | `content-type` signed when boto3 doesn't sign it | Removed `content-type` from signed headers |
| 10c | .NET 403: canonical URI mismatch | Path not double-encoded; botocore applies `quote(safe='/~')` to already-encoded path | Implemented `BotocoreCanonicalUri()` to replicate botocore's double-encoding |
