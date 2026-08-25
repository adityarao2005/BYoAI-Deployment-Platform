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
- **Pluggable Authentication**: mTLS, Bearer Token, API Key, and Basic Auth.
- **Task Primitives**: Command execution (unary & streaming), filesystem read/write/list, GUI capabilities check.
- **Session Lifecycle & Cleanup**: Heartbeat keepalives, idle timeout sweeps, and automatic workspace directory cleanup.

## Getting Started

### Task Commands
Run unified commands from the root using `task`:

- **Run Harness**: `task run_harness`
- **Run Unit Tests**: `task unit_test`
- **Run Integration Tests**: `task integration_test`

### Computer Controller Commands
```bash
cd computer_controller
go run ./cmd/controller   # Start service
go test -v ./...           # Run unit tests
```