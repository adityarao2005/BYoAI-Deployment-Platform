# BYoAI-Deployment-Platform

The Platform to Deploy AI Agents.

View design docs in [docs/design/](docs/design/).

## Architecture & Sub-projects

### Local Models (`local_models/`)
Python-based local LLM server setup utilizing `uv` and Docker Compose.

### Agent Platform (`@byo-ai-agent-platform/`)
TypeScript-based monorepo managed with `bun`, containing the `@byo-ai-agent-platform/core` library and `@byo-ai-agent-platform/agentic-harness` application.

### Computer Controller (`computer_controller/`)
Golang-based daemon service providing remote execution primitives for AI Agents:
- **ConnectRPC & HTTP streaming** protocol support (`connectrpc.com/connect`).
- **YAML-driven Provider Architecture**: Supports `local` host execution and `docker` container sandboxing configured via `computer.yaml`.
- **Task Primitives**: Command execution (unary & streaming), filesystem read/write/list, GUI capabilities check.
- **Session Lifecycle**: Sandbox container creation, capability detection, and session-based computer primitives.

For detailed configuration schema, build, run, and test guides, see [computer_controller/README.md](computer_controller/README.md).

## Examples

Explore runnable agent configurations in [`examples/`](examples/):

- **[Pet Adoption & Store Agent](examples/pet-adoption-agent/README.md)** (`examples/pet-adoption-agent/`):
  Demonstrates dynamic OpenAPI tool execution against Swagger Petstore, progressive skill loading from a packaged zip archive, and interactive console observability.
- **[Computer Use Agent](examples/computer-use-agent/README.md)** (`examples/computer-use-agent/`):
  Demonstrates an agent equipped with direct computer execution primitives (bash command execution, filesystem manipulation, and environment sandboxing).

## Getting Started

### Task Commands
Run unified commands from the root using `task`:

- **Build All**: `task build`
- **Run Harness**: `task run_harness`
- **Run Unit Tests**: `task unit_test`
- **Run Integration Tests**: `task integration_test`

### Computer Controller Commands
Ensure a valid `computer.yaml` file exists in `computer_controller/`:

```yaml
type: local
```

Then run:
```bash
cd computer_controller
task run             # Start service (or: go run ./cmd/controller)
task test            # Run unit tests (or: go test -v ./...)
task docker_test     # Run Docker integration tests
```