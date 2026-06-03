#!/usr/bin/env bash
# Tears down the Risk-Taker Tool QA POC (see docs/poc-deployment.md).
# Deletes only the risktaker=poc resources, in dependency order.
# Reused infra (VPC, ALB, cluster, AgentCore, secrets, zone) is left untouched.
set -uo pipefail

QA=cko-gen3-qa
PG=cko-gen3-pg
R=eu-west-1
ZONE=Z040419528EXGV97K01V1
HOST=risk-taker-tool.merchant-risk-assessment.qa.ckotech.internal
ALB_DNS=internal-duediligence-int-lb-405130669.eu-west-1.elb.amazonaws.com
ALB_ZONE=Z32O12XQLNTSW2
LISTENER=arn:aws:elasticloadbalancing:eu-west-1:944945738260:listener/app/duediligence-int-lb/d270875f294e359b/9e70ccc7201fe6d7
RULE=arn:aws:elasticloadbalancing:eu-west-1:944945738260:listener-rule/app/duediligence-int-lb/d270875f294e359b/9e70ccc7201fe6d7/1792af9a81ea1285
CERT=arn:aws:acm:eu-west-1:944945738260:certificate/199e03b5-a19e-4022-81eb-51597b30a538
TG=arn:aws:elasticloadbalancing:eu-west-1:944945738260:targetgroup/risktaker-poc-tg/f26a42c0e56def96
SG=sg-0007f8466c283e298

step() { echo "==> $*"; }

step "Route53 record delete"
cat >/tmp/rtt-r53-del.json <<JSON
{"Changes":[{"Action":"DELETE","ResourceRecordSet":{"Name":"$HOST","Type":"A","AliasTarget":{"HostedZoneId":"$ALB_ZONE","DNSName":"$ALB_DNS","EvaluateTargetHealth":false}}}]}
JSON
aws route53 change-resource-record-sets --profile $QA --hosted-zone-id $ZONE --change-batch file:///tmp/rtt-r53-del.json >/dev/null 2>&1 || true

step "Listener rule delete"
aws elbv2 delete-rule --profile $QA --region $R --rule-arn "$RULE" 2>&1 || true

step "Remove cert from listener (SNI)"
aws elbv2 remove-listener-certificates --profile $QA --region $R --listener-arn "$LISTENER" --certificates CertificateArn="$CERT" 2>&1 || true

step "ECS service scale to 0 + delete"
aws ecs update-service --profile $QA --region $R --cluster duediligence_ecs --service risktaker-poc-api --desired-count 0 >/dev/null 2>&1 || true
aws ecs delete-service --profile $QA --region $R --cluster duediligence_ecs --service risktaker-poc-api --force >/dev/null 2>&1 || true

step "Deregister task definitions"
for arn in $(aws ecs list-task-definitions --profile $QA --region $R --family-prefix risktaker-poc-api --query 'taskDefinitionArns[]' --output text 2>/dev/null); do
  aws ecs deregister-task-definition --profile $QA --region $R --task-definition "$arn" >/dev/null 2>&1 || true
done

step "Delete target group"
aws elbv2 delete-target-group --profile $QA --region $R --target-group-arn "$TG" 2>&1 || true

step "Delete security group (retries while ENIs detach)"
for i in 1 2 3 4 5 6; do
  aws ec2 delete-security-group --profile $QA --region $R --group-id "$SG" 2>/dev/null && break || { echo "   SG busy, retrying ($i)…"; sleep 20; }
done

step "Delete CloudWatch log group"
aws logs delete-log-group --profile $QA --region $R --log-group-name /aws/ecs/risktaker-poc 2>&1 || true

step "Delete IAM roles"
aws iam detach-role-policy --profile $QA --role-name risktaker-poc-exec-role --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy 2>&1 || true
aws iam delete-role --profile $QA --role-name risktaker-poc-exec-role 2>&1 || true
aws iam delete-role-policy --profile $QA --role-name risktaker-poc-task-role --policy-name risktaker-poc-task-inline 2>&1 || true
aws iam delete-role --profile $QA --role-name risktaker-poc-task-role 2>&1 || true

step "Delete ACM cert"
aws acm delete-certificate --profile $QA --region $R --certificate-arn "$CERT" 2>&1 || true

step "Delete ECR repo (cko-gen3-pg)"
aws ecr delete-repository --profile $PG --region $R --repository-name risktaker-poc-api --force 2>&1 || true

echo "==> Teardown complete."
