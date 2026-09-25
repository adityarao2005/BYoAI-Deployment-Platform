# System Architecture Overview

This directory documents the high-level architecture, deployment plans, execution engines, and security specifications for the **BYoAI Deployment Platform**.

---

## Agentic Lifecycle

![Agentic Lifecycle](/docs/images/agentic-lifecycle.png)

---

## Kubernetes Deployment Plan

The platform uses custom Kubernetes Custom Resource Definitions (CRDs) to manage models, agents, and client interfaces declaratively:

1. **AI Models CRD (`AIModel`)**:
   - **Self-Hosted Models**: Docker image definitions, model weights, API interface type (OpenAI-compatible / vLLM / Ollama), and resource limits (CPU/Memory/GPU).
   - **Cloud Models**: Configuration and secret bindings for cloud LLM providers (Gemini, Claude, GPT).

2. **AI Agents CRD (`AIAgent`)**:
   - **Tool Access**:
     - Sandboxed pod execution via SSH or GUI client primitives.
     - MCP server bindings (SSE, Streamable HTTP, or STDIO with sidecar transport).
     - OpenAPI tool specifications with authenticated egress.
     - Auto-approved tool policies.
   - **Model Preferences**: Model selection rankings and fallback options.
   - **Skills**: Skill repository attachments (Zip archives or Git repositories).
   - **Memory & State**: Persistence backends (Redis, PostgreSQL, JSON disk storage).
   - **Telemetry & Isolation**: OpenTelemetry tracing, network policies, inbound/outbound message queues.

3. **Frontends CRD (`AgentFrontend`)**:
   - **Kubernetes Jobs**: CronJobs or one-shot task executions posting prompts into agent queues.
   - **API Services**: Webhook, OpenAPI, or MCP server endpoints.
   - **Chat Interface**: Interactive UI supporting user approvals and message queueing.

4. **Deployment Manager CRD (`AIDeploymentManager`)**:
   - Orchestrates, scales, and monitors all models, agents, and frontends within a namespace.

---

## Architecture Sitemap

- **[Agent Harness & Authentication](harness.md)**: Details on the TypeScript Agent Harness, event-driven messaging, `UserTokenManager`, and context-driven OAuth2 token propagation.
- **[Computer Controller & Sandboxing](computer-controller.md)**: Details on the Golang `computer_controller` daemon, ConnectRPC primitives, Docker sandboxing, and MCP stdio transport.
- **Frontend Applications (`apps/`)**:
  - **API Gateway (`apps/api-gateway/`)**: Go OAuth Resource Server proxying programmatic client/SDK requests to the Agentic Harness.
  - **Chat UI (`apps/chat-ui/`)**: React + Tailwind + shadcn/ui frontend served by a Go backend OAuth confidential client.
  - **Shell CLI (`apps/shell-cli/`)**: Go + Bubble Tea TUI terminal client using OAuth PKCE for developer workflows.
