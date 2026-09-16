# `@byo-ai-agent-platform/core`

The core library for building, configuring, and executing AI Agents. It provides modular abstractions for LLM providers, tool execution (OpenAPI, Computer Use, MCP), skill repository loading, memory management, and agent communication.

---

## Installation

```bash
bun add @byo-ai-agent-platform/core
```

---

## Package Architecture & Core Modules

The package is organized into decoupled modules available as named exports:

| Module | Exported Symbols | Description |
| :--- | :--- | :--- |
| **`@byo-ai-agent-platform/core/agents`** | `AgentManager`, `AgentMemory`, `InMemoryAgentMemoryManager`, `InMemoryAgentCommunicator`, `ConsoleAgentObserver` | Agent orchestration, state machine, memory, and events. |
| **`@byo-ai-agent-platform/core/models`** | `OpenAIModel`, `GeminiModel`, `AnthropicModel`, `SelfHostedModel`, `modelRegistry` | LLM model clients and registry. |
| **`@byo-ai-agent-platform/core/tools`** | `OpenAPIToolProvider`, `ComputerUseToolProvider`, `McpServerToolProvider`, `toolProviderRegistry` | Tool providers including OpenAPI specs, Computer primitives, and MCP servers. |
| **`@byo-ai-agent-platform/core/skills`** | `ZipSkillRepository`, `GitSkillRepository`, `skillRepositoryRegistry` | Progressive skill loading from Git or Zip repos. |
| **`@byo-ai-agent-platform/core/computer`** | `createComputerProvider`, `LocalComputerProvider`, `RemoteComputerProvider` | Local host or remote Docker container computer primitives. |
| **`@byo-ai-agent-platform/core/config`** | `ModelConfigSchema`, `SkillRepositoryConfigSchema`, `ToolProviderConfigSchema` | Zod validation schemas for YAML/JSON configurations. |

---

## Programmatic Usage Quickstart

You can use `@byo-ai-agent-platform/core` directly in TypeScript code without `agent.yaml`:

```typescript
import { AgentManager, InMemoryAgentCommunicator, InMemoryAgentMemoryManager, ConsoleAgentObserver } from "@byo-ai-agent-platform/core/agents";
import { OpenAIModel, modelRegistry } from "@byo-ai-agent-platform/core/models";
import { OpenAPIToolProvider } from "@byo-ai-agent-platform/core/tools";

// 1. Instantiate and register an LLM model
const model = new OpenAIModel("gpt-4o", process.env.OPENAI_API_KEY!);
modelRegistry.registerModel("gpt-4o", model);

// 2. Setup OpenAPI tool provider
const openApiToolProvider = new OpenAPIToolProvider({
  name: "petstore",
  type: "openapi",
  specUrl: "https://petstore.swagger.io/v2/swagger.json"
});

// 3. Initialize AgentManager with memory, communicator, and observers
const communicator = new InMemoryAgentCommunicator();
const memoryManager = new InMemoryAgentMemoryManager();

const manager = new AgentManager({
  name: "petstore-assistant",
  description: "An AI agent that manages pet store operations.",
  model,
  toolProviders: [openApiToolProvider],
  memoryManager,
  communicator,
  observers: [new ConsoleAgentObserver()],
});

// 4. Start manager and create agent instance
await manager.init();
const agent = await manager.createAgent();

// 5. Send user message
await communicator.sendUserMessage(agent, "Find available pets in the store");
```

---

## Generating API Reference Docs (TypeDoc)

All exported interfaces, classes, and types in `@byo-ai-agent-platform/core` are documented with standard **TSDoc / JSDoc (`/** ... */`)** comments.

To generate standalone HTML API documentation for the core package:

1. Install TypeDoc:
   ```bash
   bun add -D typedoc
   ```

2. Build API documentation:
   ```bash
   bunx typedoc --out docs/api/core src/index.ts
   ```
