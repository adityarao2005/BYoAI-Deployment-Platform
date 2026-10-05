# Pluggable Messaging & Database Persistence Example

This example demonstrates how to configure and deploy the **Agentic Harness** using external dynamic plugins for messaging and database persistence:
- **Event Messaging**: [`@byo-ai-agent-platform/redis-connector`](file:///home/aditya/projects/BYoAI-Deployment-Platform/packages/redis-connector) (Redis Streams & PubSub)
- **Chat Memory (`chatMemory`)**: [`@byo-ai-agent-platform/postgres`](file:///home/aditya/projects/BYoAI-Deployment-Platform/packages/postgres) (PostgreSQL transcript persistence)
- **User Token Store (`tokenStore`)**: [`@byo-ai-agent-platform/redis`](file:///home/aditya/projects/BYoAI-Deployment-Platform/packages/redis) (Redis key-value store with native TTL expiration)
- **Computer Session Store (`computerStore`)**: [`@byo-ai-agent-platform/mongo`](file:///home/aditya/projects/BYoAI-Deployment-Platform/packages/mongo) (MongoDB document store for sandbox lifecycles)

---

## 🏛️ Architecture Overview

The Agentic Harness runtime is fully decoupled from proprietary database drivers and message broker libraries. Instead of bundling every client into the base harness image, the harness dynamically resolves and instantiates packages specified in `agent.yaml` via Bun:

```mermaid
graph TD
    YAML["agent.yaml<br/>(messaging & persistence)"] --> Harness["Agentic Harness Runtime<br/>(:3000)"]
    
    subgraph "Dynamic Plugins (/workspace/node_modules)"
        Harness -->|"messaging.package"| RedisConn["@byo-ai-agent-platform/redis-connector"]
        Harness -->|"persistence.chatMemory"| Postgres["@byo-ai-agent-platform/postgres"]
        Harness -->|"persistence.tokenStore"| RedisPersist["@byo-ai-agent-platform/redis"]
        Harness -->|"persistence.computerStore"| Mongo["@byo-ai-agent-platform/mongo"]
    end

    subgraph "Infrastructure Services"
        RedisConn --> RedisSvc["Redis:6379<br/>(Streams + PubSub)"]
        RedisPersist --> RedisSvc
        Postgres --> PostgresSvc["PostgreSQL:5432<br/>(Transcripts Table)"]
        Mongo --> MongoSvc["MongoDB:27017<br/>(Computer Sessions)"]
    end
```

---

## 📦 Dynamic Plugin Docker Pattern

To add messaging and persistence plugins to the harness, use a multi-stage Docker build that runs `bun add` in `/workspace`:

```dockerfile
# Stage 1: Install plugins via Bun
FROM oven/bun:1-slim AS plugin-installer
WORKDIR /workspace/plugins

RUN bun init -y && \
    bun add @byo-ai-agent-platform/redis-connector \
            @byo-ai-agent-platform/postgres \
            @byo-ai-agent-platform/redis \
            @byo-ai-agent-platform/mongo

# Stage 2: Distroless Harness Runtime with plugins attached
FROM agentic-harness:latest
COPY --from=plugin-installer --chown=65532:65532 /workspace/plugins/node_modules /workspace/node_modules
COPY --chown=65532:65532 agent.yaml /workspace/agent.yaml

USER 65532:65532
WORKDIR /workspace
ENV AGENT_CONFIG_PATH=/workspace/agent.yaml
ENTRYPOINT ["bun", "run", "/app/apps/agentic-harness/dist/index.js"]
```

Because the base harness container sets `ENV NODE_PATH="/workspace/node_modules:/app/node_modules"`, all dynamic packages in `/workspace/node_modules` are automatically discovered and loaded at runtime.

---

## ⚙️ Configuration (`agent.yaml`)

```yaml
name: clustered-research-agent

# 1. Dynamic Messaging Connector
messaging:
  package: "@byo-ai-agent-platform/redis-connector"
  properties:
    url: "redis://redis:6379"
    telemetryTopic: "agentic:telemetry"
    commandsStream: "agentic:commands"

# 2. Dynamic Persistence Stores (Mix-and-Match)
persistence:
  chatMemory:
    provider: "@byo-ai-agent-platform/postgres"
    properties:
      url: "postgresql://postgres:postgres@postgres:5432/byoai"
  tokenStore:
    provider: "@byo-ai-agent-platform/redis"
    properties:
      url: "redis://redis:6379"
  computerStore:
    provider: "@byo-ai-agent-platform/mongo"
    properties:
      url: "mongodb://mongo:27017/byoai"
```

### Built-in Shorthands

Users can also use the built-in storage engines:
```yaml
# Use in-memory for everything (default):
persistence: in_memory

# Use JSON file storage on disk for everything:
persistence: json_files

# Mix-and-match built-ins and plugins:
persistence:
  chatMemory: json_files
  tokenStore: in_memory
  computerStore:
    provider: "@byo-ai-agent-platform/redis"
```

---

## 🚀 Running with Docker Compose

1. Build the base container images first:
   ```bash
   task build_container_images
   ```

2. Start the full stack with plugins:
   ```bash
   cd examples/plugin-messaging-and-db
   docker compose up --build
   ```

3. Verify service health:
   ```bash
   curl http://localhost:3000/health
   ```
