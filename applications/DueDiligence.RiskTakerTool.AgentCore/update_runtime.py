"""
Updates the AgentCore Runtime to use the latest ECR image.
Run after pushing a new Docker image to ECR.

  cd agentcore
  AWS_PROFILE=cko-gen3-qa python update_runtime.py
"""

import boto3
import time

RUNTIME_ID = "due_diligence_logs_teller_agentruntime-ZRS6L187pp"
CONTAINER_URI = (
    "101852531977.dkr.ecr.eu-west-1.amazonaws.com"
    "/bedrock-agentcore-due_diligence_logs_teller_agentruntime:latest"
)
ENV_VARS = {
    "AWS_REGION": "eu-west-1",
    "AWS_DEFAULT_REGION": "eu-west-1",
    "MODEL_ID": "eu.anthropic.claude-sonnet-4-5-20250929-v1:0",
}

client = boto3.client("bedrock-agentcore-control", region_name="eu-west-1")

ROLE_ARN = "arn:aws:iam::944945738260:role/due-diligence-logs-teller-runtime-role"

print(f"Updating runtime {RUNTIME_ID}...")
client.update_agent_runtime(
    agentRuntimeId=RUNTIME_ID,
    agentRuntimeArtifact={
        "containerConfiguration": {
            "containerUri": CONTAINER_URI,
        }
    },
    roleArn=ROLE_ARN,
    networkConfiguration={"networkMode": "PUBLIC"},
    environmentVariables=ENV_VARS,
)

print("Polling for READY...")
while True:
    resp = client.get_agent_runtime(agentRuntimeId=RUNTIME_ID)
    status = resp["status"]
    print(f"  {status}")
    if status in {"READY", "UPDATE_FAILED", "CREATE_FAILED"}:
        break
    time.sleep(15)

if status == "READY":
    print("Done — runtime is READY.")
else:
    print(f"Failed with status: {status}. Check CloudWatch logs.")
