import { describe, expect, it } from "bun:test";
import {
    AgentMemoryManager,
    ComputerLifecycleManager,
    SqliteAgentMemoryManager,
    SqliteComputerLifecycleManager,
    SqliteUserTokenManager,
    UserTokenManager,
    createChatMemory,
    createComputerStore,
    createTokenStore,
} from "./index";

describe("SQLite Persistence Unit Tests - All 3 Managers", () => {
    it("exposes all 3 persistence managers and factories", () => {
        expect(SqliteAgentMemoryManager).toBeDefined();
        expect(SqliteUserTokenManager).toBeDefined();
        expect(SqliteComputerLifecycleManager).toBeDefined();

        expect(AgentMemoryManager).toBe(SqliteAgentMemoryManager);
        expect(UserTokenManager).toBe(SqliteUserTokenManager);
        expect(ComputerLifecycleManager).toBe(SqliteComputerLifecycleManager);

        const chat = createChatMemory({ path: ":memory:" });
        const token = createTokenStore({ path: ":memory:" });
        const comp = createComputerStore({ path: ":memory:" });

        expect(chat).toBeInstanceOf(SqliteAgentMemoryManager);
        expect(token).toBeInstanceOf(SqliteUserTokenManager);
        expect(comp).toBeInstanceOf(SqliteComputerLifecycleManager);
    });

    it("SqliteUserTokenManager sets, gets, and expires tokens in memory", async () => {
        const tokenStore = new SqliteUserTokenManager({ path: ":memory:" });

        await tokenStore.setUserToken("user-sqlite-1", {
            accessToken: "tok-sqlite-abc",
            tokenType: "Bearer",
            expiresAt: Date.now() + 60_000,
            extraHeaders: { "X-Test": "sqlite" },
        });

        const token = await tokenStore.getUserToken("user-sqlite-1");
        expect(token).toBeDefined();
        expect(token?.accessToken).toBe("tok-sqlite-abc");
        expect(token?.extraHeaders).toEqual({ "X-Test": "sqlite" });

        // Test clear
        await tokenStore.clearUserToken("user-sqlite-1");
        const afterClear = await tokenStore.getUserToken("user-sqlite-1");
        expect(afterClear).toBeUndefined();

        await tokenStore.destroy();
    });

    it("SqliteComputerLifecycleManager saves, retrieves, and clears sessions", async () => {
        const compStore = new SqliteComputerLifecycleManager({ path: ":memory:" });
        const scope = {
            lifecycle: "interaction" as const,
            agentName: "agent-sqlite",
            userId: "u-sqlite",
            interactionId: "int-123",
        };

        await compStore.setComputer(scope, {
            computerId: "comp-sqlite-99",
            lifecycle: "interaction",
            skillsPath: "/test/skills",
        });

        const record = await compStore.getComputer(scope);
        expect(record?.computerId).toBe("comp-sqlite-99");
        expect(record?.lifecycle).toBe("interaction");
        expect(record?.skillsPath).toBe("/test/skills");

        await compStore.removeComputer(scope);
        const afterRemove = await compStore.getComputer(scope);
        expect(afterRemove).toBeUndefined();

        await compStore.destroy();
    });

    it("SqliteAgentMemoryManager creates memory, adds transcripts, and reads memory", async () => {
        const memoryManager = new SqliteAgentMemoryManager({ path: ":memory:" });

        const id = await memoryManager.createAgentMemoryEntry(
            "SQLite Agent",
            "user-sqlite-456",
            "interactive",
        );

        expect(id).toBeDefined();

        await memoryManager.addTranscriptEntries(id, [
            {
                type: "message",
                role: "user",
                content: "Hello SQLite",
            },
            {
                type: "message",
                role: "assistant",
                content: "Hello! I am backed by SQLite and Drizzle ORM.",
            },
        ]);

        const memory = await memoryManager.getAgentMemory(id);
        expect(memory.name).toBe("SQLite Agent");
        expect(memory.userId).toBe("user-sqlite-456");
        expect(memory.transcript.length).toBe(2);
        expect((memory.transcript[0] as any)?.content).toBe("Hello SQLite");
        expect((memory.transcript[1] as any)?.content).toBe(
            "Hello! I am backed by SQLite and Drizzle ORM.",
        );

        const handle = await memoryManager.getAgent(id);
        expect(handle?.id).toBe(id);
        expect(handle?.name).toBe("SQLite Agent");

        const all = await memoryManager.getAllAgents();
        expect(all).toContain(id);

        await memoryManager.destroy();
    });
});
