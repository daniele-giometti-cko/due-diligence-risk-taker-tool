FROM public.ecr.aws/docker/library/python:3.12-slim
WORKDIR /app

COPY requirements.txt .
RUN python -m pip install --no-cache-dir -r requirements.txt

COPY agent_runtime.py .

ENV AWS_REGION=eu-west-1
ENV AWS_DEFAULT_REGION=eu-west-1
ENV DOCKER_CONTAINER=1

RUN useradd -m -u 1000 bedrock_agentcore
USER bedrock_agentcore

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD python -c "import socket; s = socket.socket(); r = s.connect_ex(('localhost', 8080)); s.close(); exit(0 if r == 0 else 1)"

CMD ["python", "agent_runtime.py"]
