# @byo-ai-agent-platform/redis

Redis persistence adapter for the BYoAI Agent Platform. Provides fast in-memory key-value and JSON storage for agent memories, computer lifecycles, and user authentication tokens using `ioredis`.

## Installation

```bash
bun add @byo-ai-agent-platform/redis
# or
npm install @byo-ai-agent-platform/redis
```

## Usage

```typescript
import {
  RedisAgentMemoryManager,
  RedisComputerLifecycleManager,
  RedisUserTokenManager,
} from "@byo-ai-agent-platform/redis";

const memoryManager = new RedisAgentMemoryManager({
  url: process.env.REDIS_URL || "redis://localhost:6379",
});
await memoryManager.initialize();
```
