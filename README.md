# BYoAI-Deployment-Platform

The Platform to Deploy AI Agents.

View design docs in [docs/design/](docs/design/).

## Architecture & Sub-projects

### Local Models (`local_models/`)
Python-based local LLM server setup utilizing `uv` and Docker Compose.

### Agentic Harness (`agentic_harness/`)
TypeScript-based harness with `pnpm` and `vitest`.

### Computer Controller (`computer_controller/`)
Golang-based daemon service providing remote execution primitives for AI Agents:
- **ConnectRPC & HTTP streaming** protocol support (`connectrpc.com/connect`).
- **YAML-driven Provider Architecture**: Supports `local` host execution and `docker` container sandboxing configured via `computer.yaml`.
- **Task Primitives**: Command execution (unary & streaming), filesystem read/write/list, GUI capabilities check.
- **Session Lifecycle & Cleanup**: Heartbeat keepalives, idle container sweeps, and automatic workspace directory cleanup.

For detailed configuration schema, build, run, and test guides, see [computer_controller/README.md](computer_controller/README.md).

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