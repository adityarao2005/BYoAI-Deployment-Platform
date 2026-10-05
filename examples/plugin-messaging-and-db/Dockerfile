# =============================================================================
# Dockerfile: Agentic Harness with Dynamic Messaging & Persistence Plugins
# Demonstrates how end users extend the official agentic-harness runtime by
# installing pluggable connectors and database drivers via Bun into /workspace.
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Plugin Installer
# Installs external plugins into /workspace/node_modules using Bun
# -----------------------------------------------------------------------------
FROM oven/bun:1-slim AS plugin-installer

WORKDIR /workspace

# In production deployments, plugins are installed from npm / private registries:
# RUN bun init -y && \
#     bun add @byo-ai-agent-platform/redis-connector \
#             @byo-ai-agent-platform/postgres \
#             @byo-ai-agent-platform/redis \
#             @byo-ai-agent-platform/mongo

# For monorepo local builds, copy the required packages and install them:
COPY package.json bun.lock ./
COPY packages/core ./packages/core
COPY packages/redis-connector ./packages/redis-connector
COPY packages/postgres ./packages/postgres
COPY packages/redis ./packages/redis
COPY packages/mongo ./packages/mongo

WORKDIR /workspace/plugins
RUN bun init -y && \
    bun add file:/workspace/packages/redis-connector \
            file:/workspace/packages/postgres \
            file:/workspace/packages/redis \
            file:/workspace/packages/mongo

# -----------------------------------------------------------------------------
# Stage 2: Distroless Harness Runtime with Plugins
# -----------------------------------------------------------------------------
FROM agentic-harness:latest

# Copy installed plugins into the runtime workspace.
# The harness automatically discovers plugins through NODE_PATH="/workspace/node_modules:/app/node_modules"
COPY --from=plugin-installer --chown=65532:65532 /workspace/plugins/node_modules /workspace/node_modules
COPY --chown=65532:65532 examples/plugin-messaging-and-db/agent.yaml /workspace/agent.yaml

USER 65532:65532
WORKDIR /workspace
ENV AGENT_CONFIG_PATH=/workspace/agent.yaml
EXPOSE 3000

ENTRYPOINT ["bun", "run", "/app/apps/agentic-harness/dist/index.js"]
