import { describe, expect, it } from "bun:test";
import {
    AgentMemoryManager,
    ComputerLifecycleManager,
    LibSqlAgentMemoryManager,
    LibSqlComputerLifecycleManager,
    LibSqlUserTokenManager,
    UserTokenManager,
    createChatMemory,
    createComputerStore,
    createTokenStore,
} from "./index";

describe("LibSQL / Turso Persistence Unit Tests - All 3 Managers", () => {
    it("exposes all 3 persistence managers and factories", () => {
        expect(LibSqlAgentMemoryManager).toBeDefined();
        expect(LibSqlUserTokenManager).toBeDefined();
        expect(LibSqlComputerLifecycleManager).toBeDefined();

        expect(AgentMemoryManager).toBe(LibSqlAgentMemoryManager);
        expect(UserTokenManager).toBe(LibSqlUserTokenManager);
        expect(ComputerLifecycleManager).toBe(LibSqlComputerLifecycleManager);

        const chat = createChatMemory({ url: ":memory:" });
        const token = createTokenStore({ url: ":memory:" });
        const comp = createComputerStore({ url: ":memory:" });

        expect(chat).toBeInstanceOf(LibSqlAgentMemoryManager);
        expect(token).toBeInstanceOf(LibSqlUserTokenManager);
        expect(comp).toBeInstanceOf(LibSqlComputerLifecycleManager);
    });

    it("LibSqlUserTokenManager sets, gets, and expires tokens in memory", async () => {
        const tokenStore = new LibSqlUserTokenManager({ url: ":memory:" });

        await tokenStore.setUserToken("user-libsql-1", {
            accessToken: "tok-libsql-abc",
            tokenType: "Bearer",
            expiresAt: Date.now() + 60_000,
            extraHeaders: { "X-Turso": "edge" },
        });

        const token = await tokenStore.getUserToken("user-libsql-1");
        expect(token).toBeDefined();
        expect(token?.accessToken).toBe("tok-libsql-abc");
        expect(token?.extraHeaders).toEqual({ "X-Turso": "edge" });

        await tokenStore.clearUserToken("user-libsql-1");
        const afterClear = await tokenStore.getUserToken("user-libsql-1");
        expect(afterClear).toBeUndefined();

        await tokenStore.destroy();
    });

    it("LibSqlComputerLifecycleManager saves, retrieves, and clears sessions", async () => {
        const compStore = new LibSqlComputerLifecycleManager({ url: ":memory:" });
        const scope = {
            lifecycle: "interaction" as const,
            agentName: "agent-libsql",
            userId: "u-libsql",
            interactionId: "int-libsql-123",
        };

        await compStore.setComputer(scope, {
            computerId: "comp-libsql-99",
            lifecycle: "interaction",
            skillsPath: "/turso/skills",
        });

        const record = await compStore.getComputer(scope);
        expect(record?.computerId).toBe("comp-libsql-99");
        expect(record?.lifecycle).toBe("interaction");
        expect(record?.skillsPath).toBe("/turso/skills");

        await compStore.removeComputer(scope);
        const afterRemove = await compStore.getComputer(scope);
        expect(afterRemove).toBeUndefined();

        await compStore.destroy();
    });

    it("LibSqlAgentMemoryManager creates memory, adds transcripts, and reads memory", async () => {
        const memoryManager = new LibSqlAgentMemoryManager({ url: ":memory:" });

        const id = await memoryManager.createAgentMemoryEntry(
            "Turso Agent",
            "user-libsql-456",
            "interactive",
        );

        expect(id).toBeDefined();

        await memoryManager.addTranscriptEntries(id, [
            {
                type: "message",
                role: "user",
                content: "Hello Turso",
            },
            {
                type: "message",
                role: "assistant",
                content: "Hello! I am backed by LibSQL / Turso and Drizzle ORM.",
            },
        ]);

        const memory = await memoryManager.getAgentMemory(id);
        expect(memory.name).toBe("Turso Agent");
        expect(memory.userId).toBe("user-libsql-456");
        expect(memory.transcript.length).toBe(2);
        expect((memory.transcript[0] as any)?.content).toBe("Hello Turso");
        expect((memory.transcript[1] as any)?.content).toBe(
            "Hello! I am backed by LibSQL / Turso and Drizzle ORM.",
        );

        const handle = await memoryManager.getAgent(id);
        expect(handle?.id).toBe(id);
        expect(handle?.name).toBe("Turso Agent");

        const all = await memoryManager.getAllAgents();
        expect(all).toContain(id);

        await memoryManager.destroy();
    });
});
