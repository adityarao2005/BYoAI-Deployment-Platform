import { describe, expect, it, mock } from "bun:test";
import {
    AgentMemoryManager,
    ComputerLifecycleManager,
    PostgresAgentMemoryManager,
    PostgresComputerLifecycleManager,
    PostgresUserTokenManager,
    UserTokenManager,
    createChatMemory,
    createComputerStore,
    createTokenStore,
} from "./index";

describe("Postgres Persistence Unit Tests - All 3 Managers", () => {
    it("exposes all 3 persistence managers and factories", () => {
        expect(PostgresAgentMemoryManager).toBeDefined();
        expect(PostgresUserTokenManager).toBeDefined();
        expect(PostgresComputerLifecycleManager).toBeDefined();

        expect(AgentMemoryManager).toBe(PostgresAgentMemoryManager);
        expect(UserTokenManager).toBe(PostgresUserTokenManager);
        expect(ComputerLifecycleManager).toBe(PostgresComputerLifecycleManager);

        const chat = createChatMemory({ url: "postgresql://localhost:5432/db" });
        const token = createTokenStore({ url: "postgresql://localhost:5432/db" });
        const comp = createComputerStore({ url: "postgresql://localhost:5432/db" });

        expect(chat).toBeInstanceOf(PostgresAgentMemoryManager);
        expect(token).toBeInstanceOf(PostgresUserTokenManager);
        expect(comp).toBeInstanceOf(PostgresComputerLifecycleManager);
    });

    it("PostgresUserTokenManager sets and gets tokens", async () => {
        const mockPool = {
            connect: mock(async () => ({
                query: mock(async () => ({ rows: [] })),
                release: mock(() => {}),
            })),
            query: mock(async (queryStr: string, params: any[]) => {
                if (queryStr.includes("SELECT access_token")) {
                    return {
                        rows: [
                            {
                                access_token: "pg-tok-1",
                                token_type: "Bearer",
                                expires_at: Date.now() + 100_000,
                                extra_headers: { "X-Env": "prod" },
                            },
                        ],
                    };
                }
                return { rows: [] };
            }),
            end: mock(async () => {}),
        } as any;

        const tokenStore = new PostgresUserTokenManager(mockPool);
        await tokenStore.setUserToken("user-pg", {
            accessToken: "pg-tok-1",
            tokenType: "Bearer",
        });

        const token = await tokenStore.getUserToken("user-pg");
        expect(token).toBeDefined();
        expect(token?.accessToken).toBe("pg-tok-1");
        expect(token?.extraHeaders).toEqual({ "X-Env": "prod" });
    });

    it("PostgresComputerLifecycleManager saves and retrieves session records", async () => {
        const mockPool = {
            connect: mock(async () => ({
                query: mock(async () => ({ rows: [] })),
                release: mock(() => {}),
            })),
            query: mock(async (queryStr: string) => {
                if (queryStr.includes("SELECT computer_id")) {
                    return {
                        rows: [
                            {
                                computer_id: "comp-pg-1",
                                lifecycle: "user",
                                skills_path: "/workspace/skills",
                            },
                        ],
                    };
                }
                return { rows: [] };
            }),
            end: mock(async () => {}),
        } as any;

        const compStore = new PostgresComputerLifecycleManager(mockPool);
        const scope = {
            lifecycle: "user" as const,
            agentName: "agent-pg",
            userId: "u-pg",
            interactionId: "int-pg",
        };

        await compStore.setComputer(scope, {
            computerId: "comp-pg-1",
            lifecycle: "user",
        });

        const record = await compStore.getComputer(scope);
        expect(record?.computerId).toBe("comp-pg-1");
        expect(record?.skillsPath).toBe("/workspace/skills");
    });

    it("PostgresAgentMemoryManager creates memory, adds transcripts, and reads memory", async () => {
        let createdId: string | undefined;
        const mockPool = {
            connect: mock(async () => ({
                query: mock(async () => ({ rows: [] })),
                release: mock(() => {}),
            })),
            query: mock(async (queryStr: string, params: any[]) => {
                if (queryStr.includes("INSERT INTO byoai_agent_memories")) {
                    createdId = params[0];
                    return { rows: [] };
                }
                if (queryStr.includes("SELECT id, name, user_id, mode")) {
                    return {
                        rows: [
                            {
                                id: createdId ?? "agent-pg-id",
                                name: "Postgres Agent",
                                user_id: "user-123",
                                mode: "interactive",
                                parent_id: null,
                                computer_id: null,
                                skills_path: null,
                            },
                        ],
                    };
                }
                if (queryStr.includes("SELECT entry FROM byoai_transcripts")) {
                    return {
                        rows: [
                            {
                                entry: {
                                    type: "message",
                                    role: "user",
                                    content: "Hello Postgres",
                                },
                            },
                        ],
                    };
                }
                return { rows: [] };
            }),
            end: mock(async () => {}),
        } as any;

        const memoryManager = new PostgresAgentMemoryManager(mockPool);
        const id = await memoryManager.createAgentMemoryEntry(
            "Postgres Agent",
            "user-123",
            "interactive",
        );

        expect(id).toBeDefined();

        await memoryManager.addTranscriptEntries(id, [
            {
                type: "message",
                role: "user",
                content: "Hello Postgres",
            },
        ]);

        const memory = await memoryManager.getAgentMemory(id);
        expect(memory.name).toBe("Postgres Agent");
        expect(memory.userId).toBe("user-123");
        expect(memory.transcript.length).toBe(1);
        expect(memory.transcript[0]?.type).toBe("message");
    });
});
