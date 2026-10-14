# @byo-ai-agent-platform/postgres

PostgreSQL persistence adapter for the BYoAI Agent Platform. Provides persistent storage for agent memories, interaction transcripts, computer lifecycle sessions, and user authentication tokens using Drizzle ORM and `pg`.

## Installation

```bash
bun add @byo-ai-agent-platform/postgres
# or
npm install @byo-ai-agent-platform/postgres
```

## Usage

```typescript
import {
  PostgresAgentMemoryManager,
  PostgresComputerLifecycleManager,
  PostgresUserTokenManager,
} from "@byo-ai-agent-platform/postgres";

// Initialize with a connection string or client configuration
const memoryManager = new PostgresAgentMemoryManager({
  connectionString: process.env.DATABASE_URL,
});
await memoryManager.initialize();
```
