# Design Docs

We first need to understand the agentic lifecycle:

## Agentic Lifecycle

![Agentic Lifecycle](/docs/images/agentic-lifecycle.png)

## Our deployment plan

The architecture for this will be like this:
1. We will have special CRD types for AI models (self hosted ones like Deepseek, Llama, Gemma, GPT-OSS and cloud models like Gemini, Claude, and GPT).
    - Self hosted AI models will require a docker image which contains the model and the type of API that is used and resource limits
    - Cloud models will require environment variables which hold the secrets for the API keys
2. We will have special CRD types for AI Agents. These are the following attributes for AI Agents: 
    1. Tool Access:
        1. Which would either be through computer use (via SSH into a sandboxed pod or via GUI through a GUI client)
            - These pods by default will not have access to anything outside the cluster but this can be overridable
            - One can declare environment variables or mount volumes via K8s secrets for the pod so any credentials required for the work will then be visible
        2. Which would be through the usage of an MCP server with tool permissions and special credentials
            - We can have something where we declare k8s secrets used for this and 
            - MCP servers can be using SSE, Streamable HTTP, and STDIO
                - SSE and Streamable HTTP will provide a URL to the MCP server
                - STDIO? prob passing in an image for an STDIO MCP with the exectuable command and the environment variables and we'll have a sidecar which exposes an SSE or HTTP area
            - We'll also have "auto-approved tools"
        3. Which would be through the usage of OpenAPI client using special credentials
        4. Credentials in either of these can be through Basic Auth, OAuth, mTLS, etc (Egress)
    2. Models: The AI Models which will be used and what preference of usage would be
    3. Skills: The list of skills that the AI Agent
    4. Memory Management: PostgreSQL, DB2, Oracle, Redis, etc
    5. Telemetry via OpenTelemetry
    6. Network policy
    7. Inbound message queue and outbound message queue (for inbound and outbound messages)
3. We will have special CRD types for the "frontend" for this access:
    - One frontend will be using this AI Agent to perform a task using a k8s Job (this handles the cronjob and other event handling)
    - One frontend will be exposing it as a webhook, OpenAPI support, or MCP support
    - One frontend will be a Chat like interface for it and using it
        - This is the only interface where interactions with the agents are enabled where the agent can ask for the user's preference and allow it to approve the use for certain tools, all other ones won't have this enabled
    - Each of these frontends when sending the job to run, will post the "prompt" into the inbound message queue of the AI Agent. Then it'll be listening/awaiting upon the response from the Agent (this would be the completion response, which in the case of the chat based interaction may be a question). Chat based items can queue messages.
4. We will also have a Deployment Manager CRD type which will manage and monitor all AI models, AI Agents, and frontends that exist in the namespace

## Computer Controller Architecture (`computer_controller/`)

The **Computer Controller** is a Golang-based service running inside target sandboxes/pods to expose OS execution primitives to AI Agents:
- **Transport**: ConnectRPC (`connectrpc.com/connect`) over HTTP/1.1 and HTTP/2 (h2c) listening on configurable address (defaults to `localhost:8080`). Supports unary RPCs, HTTP streaming (SSE), and gRPC / JSON requests.
- **Provider Architecture & Configuration**:
  - Configured at runtime via `computer.yaml` in the server's working directory (`config.LoadConfigFromFile()`). Supports optional `server.host` and `server.port` overrides.
  - **Local Provider (`type: local`)**: Host-level execution engine without container virtualization.
  - **Docker Provider (`type: docker`)**: Containerized sandbox lifecycle management, supporting custom Docker host endpoints, API versions, TLS certificate directories, and configurable image pull policies (`IfNotPresent`, `Always`, `Never`).
- **Session & Capability Detection**: 
  - Dynamic capability detection (`has_display`, display size, supported features).
  - Explicit session lifecycle management with `CreateComputer`, `GetComputer`, and `DeleteComputer` RPC endpoints.
- **Execution Primitives**: Synchronous and streaming shell command execution, file read/write/list, and GUI interaction hooks.

The admins working on building their AI Agents can either manage it via Kubernetes or through the admin console.

## Computer Use Tool Provider Architecture (`agentic_harness/src/tools/computer_use/`)

The TypeScript Agent Harness integrates computer use capabilities via a decoupled provider architecture:
- **Interfaces (`computer.ts`)**:
  - `HeadlessComputer`: Contract for basic execution (shell execution, file read/write/list, user/group IDs).
  - `GraphicalComputer`: Contract for desktop GUI automation (screenshot capture, mouse click/move/drag/scroll, keyboard input, clipboard management, screen geometry).
- **Tool Transformer (`builder.ts`)**:
  - `buildComputerTools(computer, isGraphical)`: Transforms any implementation of `HeadlessComputer` or `GraphicalComputer` into executable agent `Tool[]` objects with JSON Schema parameter validation.
- **Providers**:
  - `RemoteComputerUseToolProvider` (`remote_provider.ts`): Connects to remote Computer Controller instances via ConnectRPC (`BasicComputerService`, `GraphicalComputerService`, `ComputerProviderService`).
  - `LocalComputerUseToolProvider` (`local_provider.ts`): Executes operations directly on the local host OS using Node process/filesystem APIs and Linux utilities (`xdotool`, `xclip`, `maim`, `scrot`, `import`).
- **Registry (`registry.ts`)**:
  - `registerComputerUseToolProvider(config)`: Reads `agent.yaml` tool provider configuration and registers the designated local or remote computer provider into `toolProviderRegistry`.

### Tool Provider Configuration Schema (`agent.yaml`)

Tool providers are declared under the `toolProviders` key in `agent.yaml`. Supported provider types include `openapi` and `computer` (with `local` and `remote` backends).

#### Example `agent.yaml` Tool Providers Configuration

```yaml
toolProviders:
  # OpenAPI Tool Provider Configuration
  - name: "petstore"
    type: openapi
    specUrl: "https://petstore.swagger.io/v2/swagger.json"
    securityVariables:
      type: apiKey
      key: "my-secret-key"
      name: "api_key"
      location: "header"

  # Computer Use Tool Provider (Local execution)
  - type: computer
    provider:
      type: local
      enableGUIToolsIfAvailable: true

  # Computer Use Tool Provider (Remote sandbox via ConnectRPC)
  - type: computer
    provider:
      type: remote
      url: "http://localhost:8080"
      image: "ubuntu:latest"
      enableGUIToolsIfAvailable: true
      envFile: ".env"
      security:
        apiKey: "agent-token"
      resources:
        cpu: "2"
        memory: "4GiB"
```

#### Tool Provider Implementation Status Summary

| Tool Provider | Feature / Component | Status | Details |
|---|---|---|---|
| **OpenAPI** | Spec Parsing & Dereferencing | **Implemented** | Supports OpenAPI 3.0/3.1 and Swagger 2.0 via `@apidevtools/swagger-parser` |
| **OpenAPI** | Dynamic Tool Schema Builder | **Implemented** | Converts HTTP paths, parameters, and JSON request body schemas into agent `Tool` objects |
| **OpenAPI** | HTTP Request Execution | **Implemented** | Supports `GET`, `POST`, `PUT`, `DELETE`, `PATCH`, `HEAD`, `OPTIONS`, `TRACE` with parameter mapping |
| **OpenAPI** | Authentication | **Implemented** | `apiKey` (header, query, cookie), `bearerToken`, `basicAuth`, `custom` headers/queryParams/pathParams |
| **OpenAPI** | OAuth2 Flow | **Unimplemented** | Schema defined; interactive token retrieval flow deferred for server component |
| **Computer Use** | Abstraction & Tool Builder | **Implemented** | `HeadlessComputer` & `GraphicalComputer` interfaces; `buildComputerTools` generates 6 basic & 13 GUI tools |
| **Computer Use** | Remote Provider (`remote`) | **Implemented** | `RemoteComputerUseToolProvider` communicates with Computer Controller via ConnectRPC |
| **Computer Use** | Local Provider (`local`) | **Implemented** | `LocalComputerUseToolProvider` uses Node child_process/fs and Linux utilities (`xdotool`, `xclip`, `maim`/`scrot`/`import`) |
| **Computer Use** | Session RBAC & Lifetime | **Unimplemented** | `computerLifetime` (server, user, session) deferred to event-driven refactor |
| **Computer Use** | Windows / macOS Local GUI | **Unimplemented** | `LocalGraphicalComputer` currently relies on Linux/X11 tools (`xdotool`, `xclip`, `maim`) |

## Agent Harness & Event-Driven Architecture (`packages/core/src/agents/`)

The agent harness operates as an asynchronous, event-driven orchestration layer separating state persistence, event transport, and tool execution:

- **Agent Orchestrator (`AgentManager`)**:
  - Manages agent lifecycle (`createAgent`, `createAgentSession`, `sendMessageToAgent`, `runAgent`).
  - Registers listeners on `AgentCommunicator` during `init()` to automatically react to incoming `user:message` events, `tool:call` execution, and `tool:complete` resolution.
  - Passes session context (`AgentSession`) containing agent identity, runtime memory, computer provider, and skill repositories to tools.
  - Contains built-in error handling wrapping tool validation and execution to emit safe error results back into the model transcript.

- **Communication Layer (`AgentCommunicator` / `packages/core/src/agents/communication/`)**:
  - Typed pub/sub bus with events:
    - `user:message`: Inbound message from client / queue.
    - `agent:run`: Trigger execution turn on current history.
    - `agent:message`: Assistant output message.
    - `agent:complete`: Turn completion.
    - `tool:call`: Tool request from model.
    - `tool:complete`: Tool result resolution.
  - **`InMemoryAgentCommunicator`**: In-process event bus for local runtime and test execution.

- **Memory Management Layer (`AgentMemoryManager` / `packages/core/src/agents/memory/`)**:
  - Manages transcript persistence and pending tool call resolution (`getPendingToolCalls()` using `Set<string>`).
  - **`InMemoryAgentMemoryManager`**: Transient memory store.
  - **`JsonFileAgentMemoryManager`**: File-backed memory store persisting each agent's conversation history and computer binding to `<storageDir>/<agentId>.json` with atomic writes.