---
name: tool-provider-development
description: Guide for creating, configuring, wrapping, and testing Tool Providers across the BYoAI platform.
---

# Tool Provider Authoring & Integration

Use this skill when adding a new tool provider, modifying tool parameters/execution logic, or integrating tools into `agentic-harness`.

---

## 1. ToolProvider Architecture

All tools in the platform implement the `ToolProvider` and `Tool` interfaces defined in `packages/core/src/tools/tools.ts`.

```typescript
export interface ToolProvider {
    readonly name?: string;
    getTools(): Promise<Tool[]>;
    getToolByName(name: string): Promise<Tool | null>;
    cleanup?(): Promise<void>;
}

export interface Tool<TSchema extends z.ZodType = z.ZodType> {
    name: string;
    description: string;
    parameters: TSchema;
    requires_user_input?: boolean;
    execute(args: z.infer<TSchema>, session: AgentSession): Promise<any>;
}
```

### The `AgentSession` Context
When `execute(args, session)` is invoked, the `session` provides access to:
- `session.agent`: Information on the executing agent (`id`, `name`, `userId`, `parentId`).
- `session.transcript`: In-memory chronological log of user, assistant, and tool turns.
- `session.communicator`: Event bus for emitting custom events (`session.communicator.emit(...)`).
- `session.computer`: Attached computer instance (if computer use is enabled).
- `session.skillRepositories`: Registered skill catalogs for on-demand skill discovery.

---

## 2. Interactive User Approval Workflow

If a tool requires human-in-the-loop confirmation before running (e.g. executing dangerous terminal commands, file deletions, or financial transactions):

1. Set `requires_user_input: true` on the tool definition.
2. In interactive mode, the harness emits `tool:decision` with `decision: "pending"`.
3. The harness pauses execution and waits for user decision via REST API (`/api/interactions/:id/decision`) or CLI prompt.
4. If approved (`action: "accept"`), `execute()` runs; if rejected (`action: "reject"`), an error is returned to the LLM turn without running the tool.
5. **Note**: In subagents and non-interactive sessions, tools with `requires_user_input: true` are intentionally stripped to prevent deadlocks.

---

## 3. Tool Filtering & Wildcards

To wrap any tool provider with whitelist/blacklist rules:

```typescript
import { FilteredToolProvider } from "@byo-ai-agent-platform/core";

const filtered = new FilteredToolProvider(underlyingProvider, {
    allowedTools: ["get_*", "fetch_item"],
    disallowedTools: ["delete_*"]
});
```

- Wildcards: `*` matches any number of characters, `?` matches a single character.
- Rule: `disallowedTools` takes precedence over `allowedTools`.

---

## 4. Registering New Providers in `agentic-harness`

1. **Define Schema**: In `packages/core/src/config/tool_config.ts`, add your schema to `ToolConfigSchema`:
   ```typescript
   export const MyToolConfigSchema = z.object({
       type: z.literal("my_tool"),
       apiKey: z.string().optional(),
   });
   ```
2. **Export Provider**: In `packages/core/src/tools/index.ts`, export your class.
3. **Register in Bootstrap**: In `apps/agentic-harness/src/bootstrap.ts`, handle your config type:
   ```typescript
   case "my_tool":
       providers.push(new MyToolProvider(config));
       break;
   ```

---

## 5. Testing Guidelines

Write unit tests using Bun's test runner in `packages/core/src/tools/<name>/index.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { MyToolProvider } from "./index";

describe("MyToolProvider", () => {
    it("lists tools and executes successfully", async () => {
        const provider = new MyToolProvider();
        const tool = await provider.getToolByName("my_tool_name");
        expect(tool).toBeDefined();

        const dummySession = {
            agent: { id: "test", name: "test", userId: "user-1" },
            transcript: [],
            communicator: { emit: () => {} },
        } as any;

        const result = await tool!.execute({ input: "value" }, dummySession);
        expect(result).toBeDefined();
    });
});
```

Verify tests via `bun test packages/core/src/tools/<name>/`.
