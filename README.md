# BYoAI-Deployment-Platform

The Platform to Deploy AI Agents.

View architecture documentation in [docs/architecture/](docs/architecture/).

## Architecture & Sub-projects

### Local Models (`local_models/`)
Python-based local LLM server setup utilizing `uv` and Docker Compose.

### Agent Platform (`@byo-ai-agent-platform/`)
TypeScript-based monorepo managed with `bun`:
- **[`@byo-ai-agent-platform/agentic-harness`](apps/agentic-harness/README.md)**: CLI application runtime for loading YAML definitions (`agent.yaml`) and running autonomous agent loops. See [apps/agentic-harness/README.md](apps/agentic-harness/README.md) for full configuration reference.
- **[`@byo-ai-agent-platform/core`](packages/core/README.md)**: Core TypeScript SDK and library for building agents, LLM integrations, computer sandboxing, and MCP tools programmatically. See [packages/core/README.md](packages/core/README.md) for API usage.


### Computer Controller (`apps/computer_controller/`)
Golang-based daemon service providing remote execution primitives for AI Agents:
- **ConnectRPC & HTTP streaming** protocol support (`connectrpc.com/connect`).
- **YAML-driven Provider Architecture**: Supports `local` host execution and `docker` container sandboxing configured via `computer.yaml`.
- **Task Primitives**: Command execution (unary & streaming), filesystem read/write/list, GUI capabilities check.
- **Session Lifecycle**: Sandbox container creation, capability detection, and session-based computer primitives.

For detailed configuration schema, build, run, and test guides, see [apps/computer_controller/README.md](apps/computer_controller/README.md).

## Examples

Explore runnable agent configurations in [`examples/`](examples/):

- **[Pet Adoption & Store Agent](examples/pet-adoption-agent/README.md)** (`examples/pet-adoption-agent/`):
  Demonstrates dynamic OpenAPI tool execution against Swagger Petstore, progressive skill loading from a packaged zip archive, and interactive console observability.
- **[Local Computer Use Agent](examples/computer-use-agent-local/README.md)** (`examples/computer-use-agent-local/`):
  Demonstrates an agent equipped with direct local host computer execution primitives (bash command execution, filesystem manipulation, and environment sandboxing).
- **[Docker Computer Use Agent](examples/docker-computer-use/README.md)** (`examples/docker-computer-use/`):
  Demonstrates an agent connected remotely over ConnectRPC to the Computer Controller daemon executing commands in an isolated Docker container sandbox.

## Getting Started

### Task Commands
Run unified commands from the root using `task`:

- **Build All**: `task build`
- **Generate Protobuf Stubs**: `task generate_proto`
- **Run Unit Tests**: `task unit_test`
- **Run Harness**: `task agentic_harness:run`

### Computer Controller Commands
Ensure a valid `computer.yaml` file exists in `apps/computer_controller/`:

```yaml
type: local
```

Then run:
```bash
cd apps/computer_controller
task run             # Start service (or: go run ./cmd/controller)
task test            # Run unit tests (or: go test -v ./...)
task docker_test     # Run Docker integration tests
```