# @byo-ai-agent-platform/libsql

LibSQL / Turso persistence adapter for the BYoAI Agent Platform. Provides edge and embedded SQL storage for agent memories, computer lifecycles, and user authentication tokens using `@libsql/client` and Drizzle ORM.

## Installation

```bash
bun add @byo-ai-agent-platform/libsql
# or
npm install @byo-ai-agent-platform/libsql
```

## Usage

```typescript
import {
  LibsqlAgentMemoryManager,
  LibsqlComputerLifecycleManager,
  LibsqlUserTokenManager,
} from "@byo-ai-agent-platform/libsql";

const memoryManager = new LibsqlAgentMemoryManager({
  url: process.env.TURSO_DATABASE_URL || "file:local.db",
  authToken: process.env.TURSO_AUTH_TOKEN,
});
await memoryManager.initialize();
```
