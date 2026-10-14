# @byo-ai-agent-platform/rabbitmq-connector

RabbitMQ messaging and event communicator adapter for the BYoAI Agent Platform. Enables fanout telemetry broadcasting and direct task work-queuing across distributed agent instances using `amqplib`.

## Installation

```bash
bun add @byo-ai-agent-platform/rabbitmq-connector
# or
npm install @byo-ai-agent-platform/rabbitmq-connector
```

## Usage

```typescript
import { RabbitMQAgentCommunicator } from "@byo-ai-agent-platform/rabbitmq-connector";

const communicator = new RabbitMQAgentCommunicator({
  url: process.env.RABBITMQ_URL || "amqp://guest:guest@localhost:5672",
});
await communicator.initialize();
```
