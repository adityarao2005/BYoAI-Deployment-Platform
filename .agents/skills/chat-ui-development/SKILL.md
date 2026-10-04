---
name: chat-ui-development
description: Architecture, component modularity, SSE event streaming, and build verification for apps/chat-ui/frontend.
---

# Chat UI Frontend Development & Streaming

Use this skill when modifying, extending, or debugging the Chat UI frontend application (`apps/chat-ui/frontend`).

---

## 1. Application Architecture

The Chat UI is a React 19 single-page application built with Vite and Tailwind CSS v4.

```
apps/chat-ui/frontend/
├── src/
│   ├── App.tsx                     # Top-level interaction manager & SSE subscriber
│   ├── components/
│   │   ├── Sidebar.tsx             # List of interactions and new chat buttons
│   │   ├── ChatView.tsx            # Main chat container view
│   │   └── chat/                   # Modular chat components
│   │       ├── ChatHeader.tsx      # Title, ID, and mode indicators
│   │       ├── ChatInput.tsx       # Message composer & disabled state handling
│   │       ├── ChatMessageItem.tsx # Message type dispatcher
│   │       ├── EmptyChatState.tsx  # Welcome view with new chat triggers
│   │       ├── ToolCallMessage.tsx # Tool inspection & interactive approvals
│   │       ├── SubAgentAccordion.tsx # Collapsible streaming subagent tree
│   │       └── index.ts            # Barrel export
│   ├── lib/
│   │   ├── api.ts                  # REST API client & SSE EventSource subscription
│   │   ├── subagent.ts             # Recursive subagent tree update utilities
│   │   └── utils.ts                # Tailwind clsx / twMerge helpers
│   └── types/
│       └── index.ts                # TypeScript interfaces (Interaction, ChatMessage, SubAgentTask)
```

---

## 2. Server-Sent Events (SSE) Streaming Protocol

The frontend connects to `GET /api/interactions/:id/stream` via `subscribeInteractionSSE()` in `src/lib/api.ts`:

| Event | Data Payload | Frontend Action |
| :--- | :--- | :--- |
| `turn:start` | `{ turnId, agentId }` | Sets `isAgentRunning: true` |
| `turn:message` | `{ turnId, content, agentId }` | Appends assistant message chunk to conversation |
| `turn:complete` | `{ turnId, agentId }` | Sets `isAgentRunning: false` |
| `tool:call:start` | `{ toolCall: { id, name, arguments, requires_user_input } }` | Renders `ToolCallMessage` with arguments |
| `tool:decision` | `{ toolCallId, decision: "pending" \| "accepted" \| "rejected" }` | Updates tool approval state / shows action buttons |
| `tool:call:result` | `{ toolCallId, result, error }` | Appends tool output to `ToolCallMessage` |
| `subagent:start` | `{ agentId, subAgentId, parentId, goal, depth }` | Inserts `SubAgentTask` into message list or nests under parent |
| `subagent:message` | `{ agentId, subAgentId, content }` | Appends live log line to subagent task |
| `subagent:complete`| `{ agentId, subAgentId, result }` | Sets task status to `completed` and records final result |
| `subagent:error`   | `{ agentId, subAgentId, error }` | Sets task status to `error` and records failure reason |
| `interaction:complete` | `{ agentId }` | Interaction completed successfully |
| `interaction:error`| `{ agentId, error }` | Displays global error banner |

---

## 3. Subagent Tree Handling (`src/lib/subagent.ts`)

Subagents can be nested recursively (depth 0, 1, 2, ...). The state tree is maintained using immutable helpers:
- `updateSubAgentTree(messages, subAgentId, updater)`: Recursively searches through top-level and nested subagents to update matching tasks.
- `attachChildSubAgent(messages, parentId, childTask)`: Finds the matching parent subagent anywhere in the hierarchy and appends the child subagent.

---

## 4. Build & Verification Procedures

Always verify your changes before finishing:

```bash
# 1. Run all frontend unit and UI component tests in non-interactive/CI mode
CI=1 bun test apps/chat-ui/frontend/src/ < /dev/null

# 2. Run Biome lint & format check on chat components
CI=1 bun run biome check apps/chat-ui/frontend/src/components/ < /dev/null

# 3. Verify production Vite bundle compiles without errors
cd apps/chat-ui/frontend && bun run build
```

> [!TIP]
> Always run `bun test` and `bun run biome check` with `CI=1` and standard input redirected (`< /dev/null`) in agent environments to prevent interactive TTY listeners from blocking subshell process termination.

