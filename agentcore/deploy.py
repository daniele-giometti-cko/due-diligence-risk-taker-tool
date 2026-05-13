"""
Deploy the Due Diligence Agentic - Logs Teller agent to AgentCore Runtime.

Usage:
  cd agentcore
  python deploy.py [--role-arn <arn>]

The script uses bedrock_agentcore_starter_toolkit.Runtime which:
  1. Builds the Docker image
  2. Creates an ECR repository (if not exists) and pushes the image
  3. Calls create_agent_runtime on the control plane
  4. Polls until the runtime is READY

After a successful run, copy the printed agentRuntimeArn into
appsettings.json under Bedrock:AgentRuntimeArn.
"""

import argparse
import os
import time

from bedrock_agentcore_starter_toolkit import Runtime

AGENT_NAME = "due_diligence_logs_teller_agentruntime"
REGION = os.environ.get("AWS_REGION", "eu-west-1")
GATEWAY_URL = (
    "https://due-diligence-logs-teller-gateway-wdp7kudkue"
    ".gateway.bedrock-agentcore.eu-west-1.amazonaws.com/mcp"
)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--role-arn", help="IAM execution role ARN for the AgentRuntime")
    args = parser.parse_args()

    runtime = Runtime()

    print(f"Configuring AgentCore Runtime '{AGENT_NAME}' in {REGION}...")
    runtime.configure(
        entrypoint="agent_runtime.py",
        execution_role=args.role_arn,
        auto_create_execution_role=(args.role_arn is None),
        auto_create_ecr=True,
        requirements_file="requirements.txt",
        region=REGION,
        agent_name=AGENT_NAME,
    )

    env_vars = {
        "MCP_GATEWAY_URL": GATEWAY_URL,
        "AWS_REGION": REGION,
        "AWS_DEFAULT_REGION": REGION,
        "MODEL_ID": "eu.anthropic.claude-3-5-sonnet-20241022-v2:0",
    }

    print("Launching (Docker build + ECR push + create_agent_runtime)...")
    print("This takes several minutes on first run.")
    result = runtime.launch(env_vars=env_vars)
    print(f"\nagentRuntimeArn: {result.agent_arn}")
    print(f"agentRuntimeId:  {result.agent_id}")

    # Poll until READY
    end_states = {"READY", "CREATE_FAILED", "UPDATE_FAILED", "DELETE_FAILED"}
    while True:
        status_response = runtime.status()
        status = status_response.endpoint["status"]
        print(f"Status: {status}")
        if status in end_states:
            break
        time.sleep(15)

    if status == "READY":
        print("\nDeployment successful!")
        print(f"\nAdd to appsettings.json:")
        print(f'  "Bedrock:AgentRuntimeArn": "{result.agent_arn}"')
    else:
        print(f"\nDeployment failed with status: {status}")
        print("Check CloudWatch logs for details.")


if __name__ == "__main__":
    main()
