# BYoAI-Deployment-Platform

The Platform to Deploy Focused and Complaint AI Agents.

## What this is?

This repo contains a list of tools which allows one to:
- create AI agents declaratively
- ensure AI agents are sandboxed and have managed complaince
- customize AI agents with skills and tools (openapi, mcp, computer use, agent to agent, etc)
- allow AI agents to manage their computers (based on container images)
- interface with AI agents via Chat UI, SDK, CLI or REST api
- manage the AI agents

## What this isn't? (or wasn't intended to be)

AI agents nowadays are either synonomous to either 1 of the following things even though agents strictly do not need to interact with users or systems in these means:
- chatbot (with or without tools)
- openclaw style agent
- coding assistant

While we do have a UI for interacting with the agent via chatbot, one could interact with the agent via CLI, SDK, or HTTP. One could also build their own customizable agent using the @core package which the main agent harness depends on.

While a lot of the functionality is shared/inspired by coding agents such as claude code, codex, opencode, antigravity, cursor, bob and what not, the tools created here weren't strictly designed for the usage of enhancing developer workflows (even though the user of this platform could make it act as a coding agent with enough tools, rules and skills). This platform was mainly designed to allow users to manage and customize their AI agents easily and declaratively while still supporting sandboxing and complaince options open to be enabled.

While a lot of the functionality provided by openclaw functionality, openclaw in the early days was very insecure. Things have changed since then and openclaw has definetly become more secure (and OpenAI and NVIDIA have made their own secure versions), this project was created with the security first mindset learning from the flaws of openclaw. OpenClaw only supports running 1 instance of a personalized jack-of-all-trades agent whereas our tools support running multiple specialized and focused agents (making information accuracy and RBAC more easier to implement on the user end).

## Architecture & Sub-projects

View architecture documentation in [docs/architecture/](docs/architecture/).

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

- **[Compliance-Governed Enterprise Agent](examples/compliance-governed-agent/README.md)** (`examples/compliance-governed-agent/`):
  Demonstrates comprehensive enterprise compliance, combining system prompt behavioral rules, external policy documents, pattern-based tool filtering, human-in-the-loop tool approvals, and fine-grained Computer Use filesystem and command execution permissions.
- **[Pet Adoption & Store Agent](examples/pet-adoption-agent/README.md)** (`examples/pet-adoption-agent/`):
  Demonstrates a full-stack deployment featuring dynamic OpenAPI tool execution against Swagger Petstore, progressive skill loading from a packaged zip archive, sandboxed computer use, and an interactive Chat UI frontend with OIDC/OAuth2 authentication.
- **[Local Computer Use Agent](examples/computer-use-agent-local/README.md)** (`examples/computer-use-agent-local/`):
  Demonstrates an agent equipped with direct local computer execution primitives (bash command execution, filesystem manipulation, and environment sandboxing) with optional full-stack Docker Compose and Chat UI support.
- **[Model Context Protocol (MCP) Agent](examples/mcp-agent/README.md)** (`examples/mcp-agent/`):
  Demonstrates Model Context Protocol (MCP) tool integration, dynamic JSON-RPC 2.0 tool and resource discovery over `stdio` transport, MCP tool filtering, human-in-the-loop approvals, and external policy rules.
- **[Docker Computer Use Agent](examples/docker-computer-use/README.md)** (`examples/docker-computer-use/`):
  Demonstrates an agent connected remotely over ConnectRPC to the Computer Controller daemon executing commands in an isolated Docker container sandbox, complete with full-stack Compose and Chat UI.

## Getting Started

### Task Commands
Run unified commands from the root using `task`:

- **Build All**: `task build`
- **Generate Protobuf Stubs**: `task generate_proto`
- **Run Unit Tests**: `task unit_test`
- **Run Harness**: `task agentic_harness:run`
- **Run Benchmarks**: `task benchmark`

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

## Where did I use AI?

I used AI coding agents as pair programmers to accelerate implementation, generate test coverage, and sanity-check architectural designs:
- **AI Tools Used**: Antigravity, GitHub Copilot.
- **Architectural Ownership & Human Design**: System architecture, component boundaries (Go ConnectRPC daemon, Bun/TypeScript runtime, local Python model stack), security sandbox isolation models, and YAML schema specifications were designed and directed by [@adityarao2005](https://github.com/adityarao2005).
- **AI Contributions**: Scaffolding boilerplate, generating protobuf definitions, expanding unit/integration test suites, and assisting with documentation.
- **Validation & QA**: 100% of generated code, schemas, and configurations were manually reviewed, debugged, and verified via end-to-end integration testing and automated test suites (`task unit_test`, `task test`, `task docker_test`) and also manual tests (by me actually running this and seeing if it works).