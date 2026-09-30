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
  - Typed pub/sub bus with events:
    - `user:message`: Inbound message from client / queue.
    - `agent:run`: Trigger execution turn on current history.
    - `agent:message`: Assistant output message.
    - `agent:complete`: Turn completion.
    - `tool:call`: Tool request from model.
    - `tool:approval_required`: Emitted when an invoked tool has `requires_user_input: true` in interactive mode, pausing tool execution until approved or rejected.
    - `tool:accept`: Client decision event to execute the pending tool call and resume the agent turn.
    - `tool:reject`: Client decision event to reject the pending tool call with an optional explanation, injecting a rejection tool response and prompting the agent to adjust its plan.
    - `tool:complete`: Tool result resolution.
  - **`InMemoryAgentCommunicator`**: In-process event bus for local runtime and test execution.

- **Memory Management Layer (`AgentMemoryManager` / `packages/core/src/agents/memory/`)**:
  - Manages transcript persistence and pending tool call resolution (`getPendingToolCalls()` using `Set<string>`).
  - **`InMemoryAgentMemoryManager`**: Transient memory store.
  - **`JsonFileAgentMemoryManager`**: File-backed memory store persisting each agent's conversation history and computer binding to `<storageDir>/<agentId>.json` with atomic writes.

---

## Compliance, Rules & Tool Governance

The platform provides fine-grained compliance controls embedded into the agent runtime:

### 1. Rules & Guidelines (`agent.yaml` & System Prompt)
- Defined as inline text strings or relative file paths (e.g. `./compliance-rules.txt`) under `rules:` in `agent.yaml`.
- File paths are resolved and loaded from disk at bootstrap (`resolveRules()`).
- Embedded cleanly into the system prompt under a dedicated `## Rules & Compliance:` section to govern LLM model instructions and behavioral boundaries.

### 2. Tool Provider Filtering (`withToolFilter`)
- Tool providers can specify pattern-based rules using wildcards (`*` and `?`):
  - **Default Behavior**: All tools are allowed by default unless explicitly blacklisted or restricted by a whitelist.
  - `allowedTools`: Optional whitelist of patterns (e.g. `["read_*_file", "search_*"]`). When omitted or empty, all tools provided by the provider remain allowed by default. If specified, only tools matching at least one pattern in the list are made available.
  - `disallowedTools` / `rejectedTools`: Blacklist of patterns (e.g. `["execute_command", "delete_*"]`). Matching tools take precedence and are completely hidden from `getToolsByName` and `getAllTools`.
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
