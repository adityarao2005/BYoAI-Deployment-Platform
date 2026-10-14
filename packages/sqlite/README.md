# @byo-ai-agent-platform/sqlite

SQLite persistence adapter for the BYoAI Agent Platform. Provides embedded disk-based storage for agent memories, computer lifecycles, and user authentication tokens using `bun:sqlite` or Node.js SQLite with Drizzle ORM.

## Installation

```bash
bun add @byo-ai-agent-platform/sqlite
# or
npm install @byo-ai-agent-platform/sqlite
```

## Usage

```typescript
import {
  SqliteAgentMemoryManager,
  SqliteComputerLifecycleManager,
  SqliteUserTokenManager,
} from "@byo-ai-agent-platform/sqlite";

const memoryManager = new SqliteAgentMemoryManager("./data/agent.db");
await memoryManager.initialize();
```
