import { describe, expect, it, mock } from "bun:test";
import {
    AgentMemoryManager,
    ComputerLifecycleManager,
    RedisAgentMemoryManager,
    RedisComputerLifecycleManager,
    RedisUserTokenManager,
    UserTokenManager,
    createChatMemory,
    createComputerStore,
    createTokenStore,
} from "./index";

describe("Redis Persistence Unit Tests - All 3 Managers", () => {
    it("exposes all 3 persistence managers and factories", () => {
        expect(RedisAgentMemoryManager).toBeDefined();
        expect(RedisUserTokenManager).toBeDefined();
        expect(RedisComputerLifecycleManager).toBeDefined();

        expect(AgentMemoryManager).toBe(RedisAgentMemoryManager);
        expect(UserTokenManager).toBe(RedisUserTokenManager);
        expect(ComputerLifecycleManager).toBe(RedisComputerLifecycleManager);

        const chat = createChatMemory({ url: "redis://localhost:6379" });
        const token = createTokenStore({ url: "redis://localhost:6379" });
        const comp = createComputerStore({ url: "redis://localhost:6379" });

        expect(chat).toBeInstanceOf(RedisAgentMemoryManager);
        expect(token).toBeInstanceOf(RedisUserTokenManager);
        expect(comp).toBeInstanceOf(RedisComputerLifecycleManager);
    });

    it("RedisUserTokenManager sets and gets tokens with TTL", async () => {
        const store = new RedisUserTokenManager({ keyPrefix: "test:token:" });
        const redisMock: any = store.client;

        const setCalls: any[] = [];
        redisMock.set = mock(async (...args: any[]) => {
            setCalls.push(args);
            return "OK";
        });

        redisMock.get = mock(async (key: string) => {
            if (key === "test:token:user-1") {
                return JSON.stringify({
                    accessToken: "tok-1",
                    tokenType: "Bearer",
                    expiresAt: Date.now() + 60_000,
                });
            }
            return null;
        });

        await store.setUserToken("user-1", {
            accessToken: "tok-1",
            tokenType: "Bearer",
            expiresAt: Date.now() + 100_000,
        });

        expect(setCalls).toHaveLength(1);
        expect(setCalls[0][2]).toBe("EX");

        const token = await store.getUserToken("user-1");
        expect(token?.accessToken).toBe("tok-1");
    });

    it("RedisComputerLifecycleManager manages computer records", async () => {
        const store = new RedisComputerLifecycleManager({ keyPrefix: "test:comp:" });
        const redisMock: any = store.client;

        redisMock.set = mock(async () => "OK");
        redisMock.get = mock(async () =>
            JSON.stringify({ computerId: "comp-1", lifecycle: "user" }),
        );

        const scope = {
            lifecycle: "user" as const,
            agentName: "agent-a",
            userId: "u-1",
            interactionId: "int-1",
        };

        await store.setComputer(scope, {
            computerId: "comp-1",
            lifecycle: "user",
        });

        const rec = await store.getComputer(scope);
        expect(rec?.computerId).toBe("comp-1");
    });

    it("RedisAgentMemoryManager creates memory, adds transcripts, and retrieves memory", async () => {
        const store = new RedisAgentMemoryManager({ keyPrefix: "test:agent:" });
        const redisMock: any = store.client;

        const storage: Record<string, string> = {};
        const lists: Record<string, string[]> = {};
        const sets: Record<string, Set<string>> = {};

        redisMock.set = mock(async (k: string, v: string) => {
            storage[k] = v;
            return "OK";
        });
        redisMock.get = mock(async (k: string) => storage[k] ?? null);
        redisMock.sadd = mock(async (k: string, v: string) => {
            if (!sets[k]) sets[k] = new Set();
            sets[k].add(v);
            return 1;
        });
        redisMock.smembers = mock(async (k: string) =>
            sets[k] ? Array.from(sets[k]) : [],
        );
        redisMock.rpush = mock(async (k: string, ...items: string[]) => {
            if (!lists[k]) lists[k] = [];
            lists[k].push(...items);
            return lists[k].length;
        });
        redisMock.lrange = mock(async (k: string) => lists[k] ?? []);

        const agentId = await store.createAgentMemoryEntry(
            "Test Agent",
            "user-abc",
            "interactive",
        );
        expect(agentId).toBeDefined();

        await store.addTranscriptEntries(agentId, [
            {
                type: "message",
                role: "user",
                content: "Hello Redis",
            },
        ]);

        const memory = await store.getAgentMemory(agentId);
        expect(memory.name).toBe("Test Agent");
        expect(memory.userId).toBe("user-abc");
        expect(memory.transcript.length).toBe(1);
        expect(memory.transcript[0]?.type).toBe("message");

        const allAgents = await store.getAllAgents();
        expect(allAgents).toContain(agentId);
    });
});
