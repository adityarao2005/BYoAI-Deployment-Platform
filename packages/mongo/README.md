# @byo-ai-agent-platform/mongo

MongoDB persistence adapter for the BYoAI Agent Platform. Provides document-based persistent storage for agent memories, interaction transcripts, computer lifecycles, and user authentication tokens using the official MongoDB Node.js driver.

## Installation

```bash
bun add @byo-ai-agent-platform/mongo
# or
npm install @byo-ai-agent-platform/mongo
```

## Usage

```typescript
import {
  MongoAgentMemoryManager,
  MongoComputerLifecycleManager,
  MongoUserTokenManager,
} from "@byo-ai-agent-platform/mongo";

const memoryManager = new MongoAgentMemoryManager({
  uri: process.env.MONGODB_URI,
  dbName: "byoai",
});
await memoryManager.initialize();
```
