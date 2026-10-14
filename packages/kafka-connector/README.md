# @byo-ai-agent-platform/kafka-connector

Apache Kafka messaging and event communicator adapter for the BYoAI Agent Platform. Enables high-throughput, partitioned event broadcasting and command dispatching across distributed agent harness instances using `kafkajs`.

## Installation

```bash
bun add @byo-ai-agent-platform/kafka-connector
# or
npm install @byo-ai-agent-platform/kafka-connector
```

## Usage

```typescript
import { KafkaAgentCommunicator } from "@byo-ai-agent-platform/kafka-connector";

const communicator = new KafkaAgentCommunicator({
  brokers: [process.env.KAFKA_BROKER || "localhost:9092"],
});
await communicator.initialize();
```
