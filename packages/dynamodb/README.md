# @byo-ai-agent-platform/dynamodb

Amazon DynamoDB persistence adapter for the BYoAI Agent Platform. Provides managed NoSQL storage for agent memories, interaction transcripts, computer lifecycles, and user authentication tokens using the AWS SDK v3.

## Installation

```bash
bun add @byo-ai-agent-platform/dynamodb
# or
npm install @byo-ai-agent-platform/dynamodb
```

## Usage

```typescript
import {
  DynamoDBAgentMemoryManager,
  DynamoDBComputerLifecycleManager,
  DynamoDBUserTokenManager,
} from "@byo-ai-agent-platform/dynamodb";

const memoryManager = new DynamoDBAgentMemoryManager({
  region: process.env.AWS_REGION || "us-east-1",
  tableName: "byoai_agent_memories",
});
await memoryManager.initialize();
```
