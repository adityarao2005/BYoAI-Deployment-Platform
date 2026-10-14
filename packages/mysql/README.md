# @byo-ai-agent-platform/mysql

MySQL persistence adapter for the BYoAI Agent Platform. Provides relational storage for agent memories, computer lifecycles, and user authentication tokens using `mysql2` and Drizzle ORM.

## Installation

```bash
bun add @byo-ai-agent-platform/mysql
# or
npm install @byo-ai-agent-platform/mysql
```

## Usage

```typescript
import {
  MysqlAgentMemoryManager,
  MysqlComputerLifecycleManager,
  MysqlUserTokenManager,
} from "@byo-ai-agent-platform/mysql";

const memoryManager = new MysqlAgentMemoryManager({
  uri: process.env.MYSQL_URL,
});
await memoryManager.initialize();
```
