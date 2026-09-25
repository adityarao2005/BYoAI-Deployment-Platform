# Computer Controller & Sandboxing Architecture

This document covers the **Computer Controller** (`apps/computer_controller/`) daemon service and the **Computer Use Tool Provider** (`packages/core/src/tools/computer_use/`) integration.

---

## Computer Controller Daemon (`apps/computer_controller/`)

The **Computer Controller** is a Golang-based service running inside target sandboxes/pods to expose OS execution primitives to AI Agents:

- **Transport**: ConnectRPC (`connectrpc.com/connect`) over HTTP/1.1 and HTTP/2 (h2c) listening on configurable address (defaults to `localhost:8080`). Supports unary RPCs, HTTP streaming (SSE), and gRPC / JSON requests.
- **Provider Architecture & Configuration**:
  - Configured at runtime via `computer.yaml` in the server's working directory (`config.LoadConfigFromFile()`). Supports optional `server.host` and `server.port` overrides.
  - **Local Provider (`type: local`)**: Host-level execution engine without container virtualization.
  - **Docker Provider (`type: docker`)**: Containerized sandbox lifecycle management, supporting custom Docker host endpoints, API versions, TLS certificate directories, and configurable image pull policies (`IfNotPresent`, `Always`, `Never`).
- **Session & Capability Detection**: 
  - Dynamic capability detection (`has_display`, display size, supported features).
  - Explicit session lifecycle management with `CreateComputer`, `GetComputer`, and `DeleteComputer` RPC endpoints.
- **Execution Primitives**: Synchronous (`Execute`) and real-time bidirectional streaming (`ExecuteStream`) shell command execution, file read/write/list, and GUI interaction hooks. `ExecuteStream` uses ConnectRPC bidirectional streaming (`ExecuteStreamRequest`/`ExecuteStreamResponse`) to relay stdin, stdout, stderr, and process exit status in real time.

---

## Computer Use Tool Provider (`packages/core/src/tools/computer_use/`)

The TypeScript Agent Harness integrates computer use capabilities via a decoupled provider architecture:

- **Interfaces (`computer.ts`)**:
  - `HeadlessComputer`: Contract for basic execution (shell execution, real-time command streaming `executeStream`, file read/write/list, user/group IDs).
  - `GraphicalComputer`: Contract for desktop GUI automation (screenshot capture, mouse click/move/drag/scroll, keyboard input, clipboard management, screen geometry).
- **Tool Transformer (`builder.ts`)**:
  - `buildComputerTools(computer, isGraphical)`: Transforms any implementation of `HeadlessComputer` or `GraphicalComputer` into executable agent `Tool[]` objects with JSON Schema parameter validation.
- **Providers**:
  - `RemoteComputerUseToolProvider` (`remote_provider.ts`): Connects to remote Computer Controller instances via ConnectRPC (`BasicComputerService`, `GraphicalComputerService`, `ComputerProviderService`). Implements `executeStream` over ConnectRPC bidi streaming.
  - `LocalComputerUseToolProvider` (`local_provider.ts`): Executes operations directly on the local host OS using Node process/filesystem APIs (`child_process.spawn` streaming for `executeStream`) and Linux utilities (`xdotool`, `xclip`, `maim`, `scrot`, `import`).
- **Computer-Use MCP Stdio Transport (`computer_transport.ts`)**:
  - `ComputerStdioClientTransport`: Custom MCP `Transport` implementation that spawns and executes MCP stdio server binaries **inside the agent's computer sandbox** (local or remote Docker container) via `computer.executeStream()`, bridging JSON-RPC lines between MCP `Client` and process stdin/stdout in real time.
- **Registry (`registry.ts`)**:
  - `registerComputerUseToolProvider(config)`: Reads `agent.yaml` tool provider configuration and registers the designated local or remote computer provider into `toolProviderRegistry`.

---

## Tool Provider Configuration Schema (`agent.yaml`)

Tool providers are declared under the `toolProviders` key in `agent.yaml`. Supported provider types include `openapi` and `computer` (with `local` and `remote` backends).

### Example `agent.yaml` Tool Providers Configuration

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

---

## Tool Provider Implementation Status Summary

| Tool Provider | Feature / Component | Status | Details |
|---|---|---|---|
| **OpenAPI** | Spec Parsing & Dereferencing | **Implemented** | Supports OpenAPI 3.0/3.1 and Swagger 2.0 via `@apidevtools/swagger-parser` |
| **OpenAPI** | Dynamic Tool Schema Builder | **Implemented** | Converts HTTP paths, parameters, and JSON request body schemas into agent `Tool` objects |
| **OpenAPI** | HTTP Request Execution | **Implemented** | Supports `GET`, `POST`, `PUT`, `DELETE`, `PATCH`, `HEAD`, `OPTIONS`, `TRACE` with parameter mapping |
| **OpenAPI** | Authentication | **Implemented** | `apiKey` (header, query, cookie), `bearerToken`, `basicAuth`, `oauth2` token propagation, `custom` headers/queryParams/pathParams |
| **OpenAPI** | OAuth2 Flow | **Implemented** | Context-driven OAuth2 token propagation via `session.authContext` when `securityVariables.type === "oauth2"` |
| **Computer Use** | Abstraction & Tool Builder | **Implemented** | `HeadlessComputer` & `GraphicalComputer` interfaces; `buildComputerTools` generates 6 basic & 13 GUI tools |
| **Computer Use** | Remote Provider (`remote`) | **Implemented** | `RemoteComputerUseToolProvider` communicates with Computer Controller via ConnectRPC (unary & bidi streaming) |
| **Computer Use** | Local Provider (`local`) | **Implemented** | `LocalComputerUseToolProvider` uses Node child_process/fs and Linux utilities (`xdotool`, `xclip`, `maim`/`scrot`/`import`) |
| **Computer Use** | MCP Stdio Transport (`computer_transport`) | **Implemented** | `ComputerStdioClientTransport` executes stdio MCP servers in local or remote computer sandboxes via `executeStream` |
| **Computer Use** | Session RBAC & Lifetime | **Unimplemented** | `computerLifetime` (server, user, session) deferred to event-driven refactor |
| **Computer Use** | Windows / macOS Local GUI | **Unimplemented** | `LocalGraphicalComputer` currently relies on Linux/X11 tools (`xdotool`, `xclip`, `maim`) |
