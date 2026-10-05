# Agent Harness & User Authentication Architecture

This document covers the **TypeScript Agent Harness** (`packages/core/src/agents/`).

---

## Agent Harness & Event-Driven Architecture (`packages/core/src/agents/`)

The agent harness operates as an asynchronous, event-driven orchestration layer separating state persistence, event transport, and tool execution:

- **Agent Orchestrator (`AgentManager`)**:
  - Manages agent lifecycle (`createAgent`, `createAgentSession`, `sendMessageToAgent`, `runAgent`).
  - Registers listeners on `AgentCommunicator` during `init()` to automatically react to incoming `user:message` events, `tool:call` execution, and `tool:complete` resolution.
  - Passes session context (`AgentSession`) containing agent identity, runtime memory, computer provider, skill repositories, and `authContext` to tools.
  - Exposes `userTokenManager` getter for session auth context manipulation.
  - Built-in error handling wrapping tool validation and execution to emit safe error results back into the model transcript.

- **Communication Layer (`AgentCommunicator` / `packages/core/src/agents/communication/`)**:
  - Typed pub/sub and queue event bus separating command dispatch from telemetry fanout:
    - `user:message`: Inbound message from client / queue (`delivery: "queue"`).
    - `agent:run`: Trigger execution turn on current history (`delivery: "queue"`).
    - `agent:message`: Assistant output message chunk (`delivery: "broadcast"`).
    - `agent:complete`: Turn completion notification (`delivery: "broadcast"`).
    - `agent:error`: Error notification (`delivery: "broadcast"`).
    - `tool:call`: Tool request from model (dispatched to worker queue for execution; broadcast to telemetry for UI progress).
    - `tool:approval_required`: Emitted when an invoked tool has `requires_user_input: true` in interactive mode, pausing tool execution until approved or rejected (`delivery: "broadcast"`).
    - `tool:accept`: Client decision event to execute the pending tool call and resume the agent turn (`delivery: "queue"`).
    - `tool:reject`: Client decision event to reject the pending tool call with an optional explanation, injecting a rejection tool response and prompting the agent to adjust its plan (`delivery: "queue"`).
    - `tool:complete`: Tool result resolution (`delivery: "broadcast"`).
    - `subagent:*`: Subagent lifecycle and message telemetry (`delivery: "broadcast"`).
  - **Delivery Modes (`DeliveryMode`)**:
    - `queue`: Competing consumer semantics for horizontally scaled clusters. Guarantees exactly one instance executes the task/command (e.g. via Kafka partition key `agentId`, RabbitMQ work queues, or Redis streams).
    - `broadcast`: Fanout semantics. Ensures all instances receive telemetry notifications to forward over active client SSE streams (`/interactions/:id/sse`).
  - **`InMemoryAgentCommunicator`**: In-process synchronous event bus for local runtime and test execution.
  - **Dynamic Broker Connectors (`agent.yaml` `messaging`)**: Supports pluggable external packages dynamically imported at bootstrap with property normalization:
    - **`@byo-ai-agent-platform/redis-connector`**: Lightweight Redis Streams (worker queue) + Redis Pub/Sub (telemetry fanout).
    - **`@byo-ai-agent-platform/rabbitmq-connector`**: AMQP Direct Work Queue (competing consumers) + Fanout Exchange (telemetry fanout).
    - **`@byo-ai-agent-platform/kafka-connector`**: Log-based streaming with partition-keyed worker consumers (`agentId`) + per-instance consumer group fanout.

### Messaging Connectors Configuration (`agent.yaml`)

```yaml
# 1. Default: In-Memory (or omitted)
messaging: in_memory

# 2. Redis Connector
messaging:
  package: "@byo-ai-agent-platform/redis-connector"
  properties:
    url: "redis://localhost:6379"
    telemetryTopic: "agentic:telemetry"
    commandsStream: "agentic:commands"
    consumerGroup: "agentic:workers"

# 3. RabbitMQ Connector
messaging:
  package: "@byo-ai-agent-platform/rabbitmq-connector"
  properties:
    url: "amqp://guest:guest@localhost:5672"
    telemetryExchange: "agentic:telemetry"
    commandsQueue: "agentic:commands"

# 4. Kafka Connector
messaging:
  package: "@byo-ai-agent-platform/kafka-connector"
  properties:
    bootstrapServers: "localhost:9092"
    clientId: "agentic-harness"
    telemetryTopic: "agentic-telemetry"
    commandsTopic: "agentic-commands"
    consumerGroup: "agentic-workers"
```

### Testing Strategy (Unit vs. Testcontainers Integration Tests)
- `task test` / `task unit_test`: Executes fast unit tests across all connectors and monorepo packages using mocked drivers.
- `task integration_test`: Spins up live Docker containers with `testcontainers` (Redis, RabbitMQ, Kafka) and verifies multi-instance queue competing consumer and broadcast fanout behavior.

### Persistence Configuration (`agent.yaml`)

The harness supports dynamic, pluggable persistence for all storage modes:
- **`chatMemory`**: Conversation transcripts, interactive mode, and subagent trees ([`AgentMemoryManager`](file:///home/aditya/projects/BYoAI-Deployment-Platform/packages/core/src/agents/agent.memory.ts)).
- **`tokenStore`**: Active user OAuth2 authentication credentials and tokens ([`UserTokenManager`](file:///home/aditya/projects/BYoAI-Deployment-Platform/packages/core/src/agents/agent.auth.ts)).
- **`computerStore`**: Computer sandbox session bindings across lifecycle scopes ([`ComputerLifecycleManager`](file:///home/aditya/projects/BYoAI-Deployment-Platform/packages/core/src/agents/agent.computer_lifecycle.ts)).

```yaml
# 1. Default: In-Memory for all three stores (or omitted)
persistence: in_memory

# 2. Local JSON files on disk for all three stores
persistence: json_files

# 3. Mix-and-match across built-in and external dynamic providers
persistence:
  chatMemory:
    provider: "@byo-ai-agent-platform/postgres"
    properties:
      url: "postgresql://postgres:postgres@localhost:5432/byoai"
  tokenStore:
    provider: "@byo-ai-agent-platform/redis"
    properties:
      url: "redis://localhost:6379"
  computerStore:
    provider: "@byo-ai-agent-platform/mongo"
    properties:
      url: "mongodb://localhost:27017/byoai"
```

Each store independently supports:
- Built-ins: `"in_memory"` (transient RAM) and `"json_files"` (file-backed JSON with atomic writes).
- Dynamic packages: Loaded at runtime via Bun without requiring harness rebuilds. No shorthands are used to ensure zero namespace collisions with custom packages or user-defined wrappers.
- All first-party providers export all three managers (`AgentMemoryManager`, `UserTokenManager`, `ComputerLifecycleManager`):
  - **`@byo-ai-agent-platform/postgres`**: PostgreSQL powered by **Drizzle ORM** (`drizzle-orm/node-postgres`), with automatic schema DDL, typed queries, and connection pooling.
  - **`@byo-ai-agent-platform/sqlite`**: Embedded SQLite powered by **Drizzle ORM** and Bun's high-performance native `bun:sqlite` engine for zero-config local and single-container deployments.
  - **`@byo-ai-agent-platform/mysql`**: MySQL & MariaDB powered by **Drizzle ORM** (`drizzle-orm/mysql2`) with automatic schema DDL and connection pooling.
  - **`@byo-ai-agent-platform/libsql`**: Edge SQLite and Turso powered by **Drizzle ORM** and `@libsql/client` supporting local file, memory, and remote edge databases.
  - **`@byo-ai-agent-platform/redis`**: High-performance key-value store powered by `ioredis` with native key TTLs for user token expiration.
  - **`@byo-ai-agent-platform/mongo`**: MongoDB & DocumentDB powered by official `mongodb` driver with strongly-typed TypeScript document schemas.
  - **`@byo-ai-agent-platform/dynamodb`**: AWS DynamoDB powered by AWS SDK v3 (`@aws-sdk/client-dynamodb` and `@aws-sdk/lib-dynamodb`) with auto-table provisioning and document client unmarshalling.

---

## Compliance, Rules & Tool Governance

The platform provides fine-grained compliance controls embedded into the agent runtime:

### 1. Rules & Guidelines (`agent.yaml` & System Prompt)
- Defined as inline text strings (e.g. `"Act professionally..."`) or file references (e.g. `file: ./compliance-rules.txt`) under `rules:` in `agent.yaml`.
- File references are resolved and loaded from disk at bootstrap (`resolveRules()`), ignoring comment lines starting with `#`.
- Embedded cleanly into the system prompt under a dedicated `## Rules & Compliance:` section to govern LLM model instructions and behavioral boundaries.

### 2. Tool Provider Filtering (`withToolFilter`)
- Tool providers can specify pattern-based rules using wildcards (`*` and `?`):
  - **Default Behavior**: All tools are allowed by default unless explicitly blacklisted or restricted by a whitelist.
  - `allowedTools`: Optional whitelist of patterns (e.g. `["read_*_file", "search_*"]`). When omitted or empty, all tools provided by the provider remain allowed by default. If specified, only tools matching at least one pattern in the list are made available.
  - `disallowedTools`: Blacklist of patterns (e.g. `["execute_command", "delete_*"]`). Matching tools take precedence and are completely hidden from `getToolsByName` and `getAllTools`.
  - `userInputTools`: Patterns requiring explicit user confirmation before execution (e.g. `["write_*", "deploy_*"]`). Matching tools receive the attribute `requires_user_input: true`.
- Dynamic decoration is provided by `withToolFilter(provider, config)` wrapping any tool provider. If no filter options are configured, the provider is returned unaltered.

### 3. Interactive vs. Non-Interactive Tool Provision
- In **non-interactive mode**, any tools requiring confirmation (`requires_user_input: true`) are omitted when supplying tools to the model, preventing deadlocks when no human is present to approve actions.
- In **interactive mode**, all allowed tools are supplied to the model.

### 4. Human-In-The-Loop Approval Workflow
- When the model invokes a tool with `requires_user_input: true` during interactive mode:
  1. The harness emits `tool:approval_required` containing `{ agentId, toolCallId, tool, args }` over SSE.
  2. The harness pauses tool execution and registers the pending approval.
  3. Client UI (Chat UI or Shell CLI) renders an interactive approval prompt (Accept / Reject).
  4. The client dispatches a decision via `POST /interactions/:id/tools/:toolCallId/decision` with `{ action: "accept" | "reject", reason?: string }`.
  5. On `accept`: The tool is executed and results are dispatched as `tool:complete`.
  6. On `reject`: A rejected tool response is recorded in transcript memory and a rejection notification is sent to the agent turn, enabling the agent to recover safely without breaking tool call invariant sequencing.

### 5. Computer Use Specific Rules (`permissions`)
Configurable under the `computer` tool provider in `agent.yaml` to restrict read, write, and command execution on the agentic harness side:
- **`permissions.read`**: Rules for `read_file` and `list_directory`. Supports file/directory paths and wildcard patterns (`*`, `?`). Any directory path automatically permits all files and subdirectories inside it.
- **`permissions.write`**: Rules for `write_file`.
- **`permissions.execute`**: Rules for shell commands and command sequences (`execute`). Checks whole command, sub-commands in chains/pipelines (`&&`, `||`, `;`, `|`), executable binary names, and wildcard patterns (e.g. `bash`, `sh`, `git commit*`, `find *`).
- **Precedence**: `disallowed` takes highest precedence; if `allowed` whitelist is specified, all actions/sub-commands must match an allowed pattern. Denials throw descriptive errors returning clear feedback to the model.

---

## Memory Architecture & Computer Lifecycles (`packages/core/src/agents/`)

The platform features a unified **`MemoryManager`** interface (`agent.unified_memory.ts`) that coordinates three distinct state domains:
1. **`agent` (`AgentMemoryManager`)**: Manages agent conversations, transcripts, interaction metadata, and handles. Implemented by `InMemoryAgentMemoryManager` and `JsonFileAgentMemoryManager`.
2. **`userToken` (`UserTokenManager`)**: Manages OAuth2 access tokens and credentials per user session with automatic expiration cleanup.
3. **`computerLifecycle` (`ComputerLifecycleManager`)**: Manages computer session mappings across different lifecycle tiers (`agent.computer_lifecycle.ts`).

### Computer Lifecycle Modes (`server`, `user`, `interaction`)

When `computerProvider` is configured in `agent.yaml`, the `lifecycle` property determines computer instance reuse:

```yaml
toolProviders:
  - type: computer
    lifecycle: user # "server" | "user" | "interaction" (defaults to "user")
    provider:
      type: local
      enableGUIToolsIfAvailable: false
```

- **`server`**: 1 computer shared for all users and interactions for this agent (`server:${agentName}`). Ideal for persistent shared service agents.
- **`user`** *(Default)*: 1 computer per user, shared across all interactions of that user with this agent (`user:${agentName}:${userId}`). Maintains user workspace persistence across multiple turns and interactions.
- **`interaction`**: 1 isolated computer session per interaction (`interaction:${interactionId}`). Completely ephemeral and destroyed or isolated per conversation.

Storage backends for computer lifecycles:
- **`InMemoryComputerLifecycleManager`**: Map-based storage in RAM.
- **`JsonFileComputerLifecycleManager`**: Persistent atomic file storage on disk.

```typescript
// Unified Memory Composition
const memoryManager = new CompositeMemoryManager({
    agent: new InMemoryAgentMemoryManager(),
    userToken: new InMemoryUserTokenManager(),
    computerLifecycle: new InMemoryComputerLifecycleManager(),
});
```

---

## User Authentication & OAuth2 Token Propagation (`packages/core/src/agents/agent.auth.ts`)

The platform implements user token management and context propagation down to downstream tools (OpenAPI and Remote MCP servers) acting on behalf of the user:

- **Token Store (`UserTokenManager` / `InMemoryUserTokenManager`)**:
  - Manages active user authentication contexts (`AuthContext`: `accessToken`, `tokenType`, `expiresAt`, `extraHeaders`).
  - Implements **timer-based automatic expiration** (`setTimeout` with Node `.unref()`) and **lazy check deletion** upon `getUserToken(userId)`.
  - Supports explicit logout via `clearUserToken(userId)`.

- **Session Context Attachment (`AgentSession.authContext`)**:
  - `AgentExecutor.createAgentSession(agentId)` automatically retrieves the user's active `AuthContext` via `manager.userTokenManager.getUserToken(agent.userId)` and attaches it to `session.authContext`.

- **Strict `oauth2` Security Scoping**:
  - **OpenAPI Tool Provider**: Injects user access tokens into HTTP `Authorization: Bearer <token>` headers **ONLY** if the OpenAPI security configuration is explicitly set to `oauth2` (`securityVariables.type === "oauth2"`).
  - **Remote MCP Tool Provider**: Injects user access tokens into HTTP transport `authProvider` **ONLY** if MCP security configuration is explicitly set to `oauth2` (`security.auth.type === "oauth2"`).
  - Static configuration credentials (such as static `bearerToken` or `apiKey`) remain isolated and are never overwritten by user session tokens.

- **Harness Authentication Middleware (`apps/agentic-harness/src/index.ts`)**:
  - Extracts JWT subject (`sub`), raw Bearer token, and expiration claim (`exp`) from incoming HTTP requests:
    ```typescript
    app.use(async (c, next) => {
        const payload = c.get("jwtPayload");
        const sub = payload?.sub;
        if (sub) {
            const authHeader = c.req.header("authorization");
            const rawToken = authHeader?.startsWith("Bearer ")
                ? authHeader.slice(7)
                : undefined;

            await manager.userTokenManager.setUserToken(sub, {
                accessToken: rawToken,
                expiresAt: typeof payload?.exp === "number" ? payload.exp : undefined,
                extraHeaders: {
                    ...(authHeader ? { authorization: authHeader } : {}),
                },
            });
        }
        await next();
    });
    ```

---

## Example Usage Workflow

```typescript
import {
    AgentManager,
    InMemoryAgentCommunicator,
    InMemoryAgentMemoryManager,
    InMemoryUserTokenManager,
} from "@byo-ai-agent-platform/core/agents";
import { OpenAPIToolProvider } from "@byo-ai-agent-platform/core/tools";

// 1. Initialize Managers
const memoryManager = new InMemoryAgentMemoryManager();
const userTokenManager = new InMemoryUserTokenManager();
const communicator = new InMemoryAgentCommunicator();

// OpenAPI provider configured with oauth2 security
const openApiOAuth2Provider = new OpenAPIToolProvider({
    name: "user-service",
    type: "openapi",
    specUrl: "https://api.example.com/openapi.json",
    securityVariables: {
        type: "oauth2", // <--- Scopes token propagation to OAuth2 endpoints only
    },
});

const manager = new AgentManager({
    name: "UserScopedAgent",
    description: "Performs API calls on behalf of the authenticated user",
    model: defaultModel,
    skillRepository: [],
    toolProviders: [openApiOAuth2Provider],
    memoryManager,
    userTokenManager,
    communicator,
});

await manager.init();

// 2. Set active user token (e.g. inside HTTP request middleware)
await manager.userTokenManager.setUserToken("user-123", {
    accessToken: "user-oauth2-access-token",
    expiresAt: Math.floor(Date.now() / 1000) + 3600, // 1 hour TTL
});

// 3. Create Agent instance and invoke a turn
const agent = await manager.createAgent("user-123");
await manager.sendMessageToAgent(agent.id, "Fetch my account profile");

// Result:
// - AgentSession attaches authContext { accessToken: "user-oauth2-access-token" }
// - OpenAPIToolProvider sends HTTP request with header `Authorization: Bearer user-oauth2-access-token`
// - Once 3600s passes, the timer automatically clears the token from userTokenManager
```

---

## Generic Tool Architecture & Zod Schema Validation (`packages/core/src/tools/`)

The platform uses a generic, Zod-based architecture for all tool definitions, replacing custom JSON Schema arguments with compile-time type safety and runtime schema validation:

### 1. Generic Tool Interface (`Tool<TSchema>`)
```typescript
export interface Tool<TSchema extends z.ZodTypeAny = z.ZodTypeAny> {
    name: string;
    description?: string;
    inputSchema: TSchema;
    requires_user_input?: boolean;
    execute(args: z.infer<TSchema>, session: AgentSession): Promise<any>;
}
```

- **Type Inference**: Tool authors use `createTool({ name, inputSchema, execute(args, session) })`, allowing TypeScript to automatically infer `args` as `z.infer<TSchema>`.
- **Type Erasure**: Because `TSchema` defaults to `z.ZodTypeAny`, heterogeneous collections like `ToolProvider.getAllTools(): Promise<Tool[]>` and `ToolProviderRegistry` treat tools with erased schema types (`z.infer<z.ZodTypeAny>` is `unknown`/`any`) without casting or complex union types.

### 2. Runtime Validation in `AgentExecutor`
When the LLM triggers a tool call, `AgentExecutor` validates inputs via Zod:
1. Runs `tool.inputSchema.safeParse(args)`.
2. On failure, returns a formatted error result (`Invalid arguments for tool ${tool.name}: ${error.message}`) to the agent turn without crashing the process.
3. On success, passes validated and coerced `parseResult.data` to `tool.execute()`.

### 3. LLM Schema Serialization (`getToolJsonSchema`)
- Zod schemas are converted to standard JSON Schema dictionaries via `getToolJsonSchema(schema)` using native Zod 4 JSON Schema conversion.
- Metadata keys like `$schema` and `~standard` are stripped to maintain strict compatibility with model parameter specifications (OpenAI function tools, Anthropic tools, Gemini function declarations, and Ollama/self-hosted endpoints).
- Dynamic tools (OpenAPI specifications, Model Context Protocol servers) are wrapped via `createJsonSchemaZodSchema(rawJsonSchema)` to preserve upstream wire schemas while exposing standard Zod validation.

---

## Subagent Orchestration & Execution (`packages/core/src/tools/subagent/`)

The platform supports in-process child agents spawned on-demand by the parent agent to decompose complex tasks into focused sub-tasks:

### 1. Architectural Principles
- **Parent/Child Relationship**: Denoted canonically by `parentId` on `AgentHandle` and persisted in `AgentMemory`. Subagents are automatically excluded from top-level interaction listings (`getAllAgents()` and `getAllAgentsByUser()`) while remaining retrievable via `getSubAgents(parentId)`.
- **Non-Interactive Execution**: Subagents operate strictly in `non-interactive` mode. Any tools requiring user approval (`requires_user_input: true`) are omitted to guarantee deterministic execution without blocking.
- **Automatic Skill Loading**: Skill repositories configured on the parent are automatically inherited by the subagent (`load_skill` tool is provided without needing explicit inheritance configuration).
- **Guarded Computer Inheritance**: Computer resources are only inherited when `inheritComputer` (or `allow_computer`) is explicitly set to `true`. When enabled, the subagent shares the parent's `computerId` and computer execution tools. When disabled, computer access is entirely isolated.
- **Selective Tool Inheritance**: `inheritedToolProviders` allows granular specification of which tool providers are inherited:
  - If omitted: All non-computer, non-recursive parent tool providers are inherited by default.
  - If specified: Can be provided as strings (`"scratchpad"`, `"mcp"`), objects (`{ name: "petstore", allowedTools: ["read*"] }`), or YAML maps (`petstore: { allowedTools: ["read*"], disallowedTools: ["write*"] }`). Wildcard matching (`*`, `?`) restricts tool exposure.
- **Recursive Subagents**: Configurable via `allowRecursive` and capped by `maxDepth` (default 3) to prevent runaway execution loops.
- **Real-Time UI Telemetry**: Subagent execution turn events (`subagent:start`, `subagent:message`, `subagent:complete`, `subagent:error`) are dispatched directly to the parent's `AgentCommunicator`, allowing SSE streams to broadcast child progress to frontend chat interfaces (e.g. nested progress accordions).

### 2. Configuration Example (`agent.yaml`)
```yaml
toolProviders:
  - type: subagent
    allowRecursive: true
    inheritComputer: false
    maxDepth: 3
    timeoutMs: 120000
    inheritedToolProviders:
      - scratchpad
      - petstore:
          allowedTools:
            - "read*"
          disallowedTools:
            - "delete*"
      - mcp
```

