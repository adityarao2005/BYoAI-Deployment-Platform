---
name: harness-architecture
description: Architecture, HTTP/SSE APIs, agent execution loop, and memory persistence in apps/agentic-harness.
---

# Agentic Harness Architecture & Execution Engine

Use this skill when modifying server endpoints, interaction lifecycles, memory storage, or multi-turn agent execution loops.

---

## 1. System Overview

`apps/agentic-harness` is the backend daemon and API gateway for running autonomous and interactive agents.

```
Client (Chat UI / CLI)
  │  HTTP REST (Commands, Decisions)
  │  SSE Stream (Real-time Turn Events)
  ▼
Hono Web Server (apps/agentic-harness/src/index.ts)
  │
  ├── AgentManager (packages/core/src/agents/agent_manager.ts)
  │    ├── AgentMemoryManager (InMemory or JsonFile storage)
  │    └── AgentCommunicator (Event emitter & cross-agent messaging)
  │
  └── AgentSession (Multi-turn LLM loop & tool execution)
       ├── Model Providers (OpenAI, Anthropic, Gemini, Ollama)
       ├── Tool Providers (OpenAPI, MCP, Computer Use, Todos, SubAgents)
       └── Computer Controller (Optional desktop/browser sandbox)
```

---

## 2. API Endpoints Reference

| Route | Method | Description |
| :--- | :--- | :--- |
| `/health` | `GET` | Service liveness probe |
| `/api/me` | `GET` | Current authenticated user profile |
| `/api/interactions` | `GET` | List top-level interactions (subagents are automatically excluded) |
| `/api/interactions` | `POST` | Create a new agent session (`mode: "interactive" \| "non-interactive"`) |
| `/api/interactions/:id` | `GET` | Interaction detail, state, and message transcript |
| `/api/interactions/:id/stream` | `GET` | Real-time Server-Sent Events (SSE) event stream |
| `/api/interactions/:id/messages` | `POST` | Send a user message to trigger an agent turn |
| `/api/interactions/:id/decision` | `POST` | Submit user approval (`accept` or `reject`) for pending tool calls |

---

## 3. Interaction Lifecycles

### Interactive Mode
- Agent runs until it produces an answer or requests user confirmation (`tool:decision` pending).
- If a tool requires approval (`requires_user_input: true`), execution halts until `/api/interactions/:id/decision` is called.
- The session remains open for subsequent user follow-up messages.

### Non-Interactive Mode
- Used for batch workflows, autonomous goals, and **all subagents**.
- Executes to completion without prompting the user.
- Any tool requiring user input is filtered out during tool registration to prevent deadlocks.

---

## 4. Memory Persistence & Subagent Isolation

- **Storage Managers**:
  - `InMemoryAgentMemoryManager`: Fast, ephemeral in-memory storage used for tests and stateless runners.
  - `JsonFileAgentMemoryManager`: File-backed persistence storing interaction metadata and transcripts on disk.
- **Subagent Filtering Invariant**:
  - When a subagent is created, its memory record stores `parentId: <parent-interaction-id>`.
  - Methods `getAllAgents()` and `getAllAgentsByUser()` strictly filter out records where `memory.parentId` exists.
  - Subagents are accessible exclusively via `getSubAgents(parentId)`.

---

## 5. Verification Commands

```bash
# Typecheck harness and core packages
bun run typecheck

# Run test suite
bun test

# Run Agentic Harness development server
task dev:harness
```
