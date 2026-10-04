---
name: subagent-development
description: Architecture, configuration, event streaming, and execution workflows for subagents in the BYoAI platform.
---

# Subagent Development & Orchestration

Use this skill when implementing, configuring, debugging, or extending subagent capabilities, tool inheritance, or hierarchical execution.

---

## 1. Architectural Mental Model

Subagents are lightweight, non-interactive autonomous child agents spawned by a parent agent via the `create_subagent` tool.

```
Parent Agent (Interaction)
 └── SubAgentToolProvider (exposes `create_subagent`)
      └── Subagent 1 (non-interactive, filtered tools, depth 1)
           └── Subagent 2 (if allowRecursive: true, depth 2 <= maxDepth)
```

### Core Invariants
1. **Context Seeding by LLM**: The parent agent's LLM determines what goal and summary context to supply to the child prompt. Raw parent transcripts are *never* blindly dumped into child history.
2. **Strict Non-Interactive Execution**: Subagents cannot prompt the user for interactive input. Any tools requiring user approval (`requires_user_input: true`) are omitted to prevent deadlocks.
3. **Computer Use Isolation**: Subagents **do not** inherit computer sessions or computer tools by default (`inheritComputer: false`). Only if explicitly enabled will computer access be granted.
4. **Automatic Skill Inheritance**: The skill loading tool (`load_skill`) is automatically provided to subagents using the parent session's skill repositories, regardless of tool filters.
5. **Recursion & Bounds**: Recursive subagents are controlled by `allowRecursive` (default: `false`), bounded by `maxDepth` (default: `3`), and guarded by `timeoutMs` (default: `120_000ms` / 2 minutes).
6. **Interaction Visibility & Isolation**: Subagents have a `parentId` stored in their memory. They are filtered out from `getAllAgents()` so they never appear as top-level user interactions in the UI sidebar, but can be retrieved via `getSubAgents(parentId)`.

---

## 2. Configuration & Tool Filtering Syntax

Subagents are configured via `subagent` tool provider config in `tools.yaml` or agent bootstrap:

```yaml
tools:
  - type: subagent
    allow_recursive: true
    max_depth: 3
    timeout_ms: 120000
    inherit_computer: false
    inherited_tool_providers:
      - mcp
      - name: petstore
        allowed_tools:
          - "get*"
          - "read_*"
        disallowed_tools:
          - "delete_*"
```

### Supported Syntax Variations for `inherited_tool_providers`
- **String name**: `"mcp"` (inherits all tools in the provider)
- **Object format**: `{ name: "petstore", allowedTools: ["read*"], disallowedTools: ["write*"] }`
- **Map format**: `{ petstore: { allowedTools: ["read*"], disallowedTools: ["write*"] } }`
- **Wildcard matching**: `*` matches 0 or more characters; `?` matches a single character.
- **Rule**: `disallowedTools` takes precedence over `allowedTools`.

---

## 3. Telemetry & SSE Streaming Architecture

Subagents emit real-time events to the parent's `AgentCommunicator`:

| Event | Payload Key Fields | Purpose |
| :--- | :--- | :--- |
| `subagent:start` | `agentId` (root), `subAgentId`, `parentId`, `goal`, `depth` | Initializes subagent accordion in Chat UI |
| `subagent:message` | `agentId` (root), `subAgentId`, `parentId`, `content`, `depth` | Streams thought steps and tool outputs |
| `subagent:complete` | `agentId` (root), `subAgentId`, `parentId`, `result`, `depth` | Final result and success badge |
| `subagent:error` | `agentId` (root), `subAgentId`, `parentId`, `error`, `depth` | Error reason and failure badge |

### Critical SSE Routing Rule
The SSE endpoint in `apps/agentic-harness` broadcasts events filtered by `payload.agentId === currentInteractionId`.
For child and recursively nested sub-subagents, events **must set `agentId` to the root interaction ID** so they are delivered over the active SSE stream. The `parentId` field preserves the exact direct parent for frontend tree nesting.

---

## 4. Key Files Reference

- **Provider Implementation**: `packages/core/src/tools/subagent/index.ts`
- **Schema & Validation**: `packages/core/src/config/tool_config.ts` (`SubAgentToolProviderConfigSchema`)
- **Event Map**: `packages/core/src/agents/agent.messaging.ts` (`subagent:*` events)
- **Memory & Isolation**: `packages/core/src/agents/memory/memory.ts`, `inmemory.memory.ts`, `jsonfile.memory.ts`
- **Harness Bootstrap**: `apps/agentic-harness/src/bootstrap.ts` and SSE broadcast in `apps/agentic-harness/src/index.ts`
- **Frontend Tree Utility**: `apps/chat-ui/frontend/src/lib/subagent.ts`
- **Frontend UI Accordion**: `apps/chat-ui/frontend/src/components/chat/SubAgentAccordion.tsx`
