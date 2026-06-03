"""
Due Diligence Agentic - Logs Teller — AgentCore Runtime

Strands agent that connects DIRECTLY to the Datadog MCP server using credentials
fetched from Secrets Manager. Bypasses the AgentCore Gateway to avoid the
dual-header auth injection limitation.

Environment variables:
  DD_API_KEY_SECRET  — Secrets Manager secret name for DD-API-KEY
                       (default: due-diligence/logs-teller-agent/dd-api-key)
  DD_APP_KEY_SECRET  — Secrets Manager secret name for DD-APPLICATION-KEY
                       (default: due-diligence/logs-teller-agent/dd-app-key)
  DD_MCP_URL         — Datadog MCP endpoint (default: EU endpoint)
  AWS_REGION         — AWS region for Secrets Manager (default: eu-west-1)
  MODEL_ID           — Bedrock model ID
"""

import json
import logging
import os

import boto3
from mcp.client.streamable_http import streamablehttp_client
from strands import Agent
from strands.models import BedrockModel
from strands.tools.mcp import MCPClient

from bedrock_agentcore.runtime import BedrockAgentCoreApp

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
DD_API_KEY_SECRET = os.environ.get(
    "DD_API_KEY_SECRET", "due-diligence/logs-teller-agent/dd-api-key"
)
DD_APP_KEY_SECRET = os.environ.get(
    "DD_APP_KEY_SECRET", "due-diligence/logs-teller-agent/dd-app-key"
)
DD_MCP_URL = os.environ.get(
    "DD_MCP_URL",
    "https://mcp.datadoghq.eu/api/unstable/mcp-server/mcp",
)
AWS_REGION = os.environ.get("AWS_REGION", "eu-west-1")
MODEL_ID = os.environ.get("MODEL_ID", "eu.anthropic.claude-sonnet-4-5-20250929-v1:0")

SYSTEM_PROMPT = (
    "You are a Due Diligence platform analyst at Checkout.com. "
    "You have access to Datadog log search tools. "
    "When given a natural language request about what happened in a service, "
    "query Datadog for relevant log events — use at most 2 queries, choosing your filters carefully on the first attempt. "
    "Always set a result limit of 50 logs per query (never fetch more). "
    "Then write a concise plain-English chronicle (under 300 words, past tense) describing the sequence of events, "
    "any errors, and the overall outcome. "
    "Never expose raw log payloads. Summarise counts and patterns instead. "
    "Always state the time window and service you queried."
)

# ---------------------------------------------------------------------------
# Secrets
# ---------------------------------------------------------------------------

def _get_dd_headers() -> dict[str, str]:
    sm = boto3.client("secretsmanager", region_name=AWS_REGION)
    api_key = sm.get_secret_value(SecretId=DD_API_KEY_SECRET)["SecretString"]
    app_key = sm.get_secret_value(SecretId=DD_APP_KEY_SECRET)["SecretString"]
    return {
        "DD-API-KEY": api_key,
        "DD-APPLICATION-KEY": app_key,
    }

# ---------------------------------------------------------------------------
# Agent — lazily initialised, shared across invocations within one container.
# ---------------------------------------------------------------------------
_agent: Agent | None = None
_mcp_client: MCPClient | None = None


def _get_agent() -> Agent:
    global _agent, _mcp_client

    if _agent is not None:
        return _agent

    logger.info("Fetching Datadog credentials from Secrets Manager")
    headers = _get_dd_headers()

    logger.info("Initialising MCPClient against %s", DD_MCP_URL)
    _mcp_client = MCPClient(
        lambda: streamablehttp_client(url=DD_MCP_URL, headers=headers)
    )
    _mcp_client.__enter__()

    tools = _mcp_client.list_tools_sync()
    logger.info("Loaded %d tools from Datadog MCP", len(tools))

    _agent = Agent(
        model=BedrockModel(model_id=MODEL_ID, max_tokens=1200),
        tools=tools,
        system_prompt=SYSTEM_PROMPT,
    )
    return _agent


# ---------------------------------------------------------------------------
# App entry point
# ---------------------------------------------------------------------------
app = BedrockAgentCoreApp()


@app.entrypoint
async def invoke(payload):
    prompt = payload.get("prompt", "")
    if not prompt:
        yield "No prompt provided."
        return

    logger.info("Invoking agent with prompt: %s", prompt[:120])
    agent = _get_agent()

    async for event in agent.stream_async(prompt):
        if "data" in event and isinstance(event["data"], str):
            yield event["data"]

    # Emit token usage as a sentinel line the .NET caller can strip and parse.
    try:
        inv = agent.event_loop_metrics.latest_agent_invocation
        usage = inv.usage if inv else {}
    except Exception:
        usage = {}
    yield "\n__METRICS__:" + json.dumps({
        "inputTokens": usage.get("inputTokens", 0),
        "outputTokens": usage.get("outputTokens", 0),
    })


if __name__ == "__main__":
    app.run()
