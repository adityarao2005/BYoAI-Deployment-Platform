# @byo-ai-agent-platform/redis-connector

Redis pub/sub messaging and event communicator adapter for the BYoAI Agent Platform. Enables multi-instance agent communication, command dispatching, and telemetry broadcasting across distributed agent runtimes.

## Installation

```bash
bun add @byo-ai-agent-platform/redis-connector
# or
npm install @byo-ai-agent-platform/redis-connector
```

## Usage

```typescript
import { RedisAgentCommunicator } from "@byo-ai-agent-platform/redis-connector";

const communicator = new RedisAgentCommunicator({
  url: process.env.REDIS_URL || "redis://localhost:6379",
});
await communicator.initialize();
```
