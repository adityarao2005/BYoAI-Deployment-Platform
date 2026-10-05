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

function extractSql(queryConfig: any): string {
    if (typeof queryConfig === "string") return queryConfig;
    return queryConfig?.text ?? "";
}

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
            query: mock(async (queryConfig: any, params: any[]) => {
                const sqlText = extractSql(queryConfig);
                if (sqlText.includes('from "byoai_user_tokens"')) {
                    if (queryConfig.rowMode === "array") {
                        // [userId, accessToken, tokenType, expiresAt, extraHeaders, updatedAt]
                        return {
                            rows: [
                                [
                                    "user-pg",
                                    "pg-tok-1",
                                    "Bearer",
                                    Date.now() + 100_000,
                                    { "X-Env": "prod" },
                                    new Date(),
                                ],
                            ],
                        };
                    }
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
            query: mock(async (queryConfig: any) => {
                const sqlText = extractSql(queryConfig);
                if (sqlText.includes('from "byoai_computer_sessions"')) {
                    if (queryConfig.rowMode === "array") {
                        // [key, computerId, lifecycle, skillsPath, createdAt]
                        return {
                            rows: [
                                [
                                    "user:agent-pg:u-pg",
                                    "comp-pg-1",
                                    "user",
                                    "/workspace/skills",
                                    1700000000000,
                                ],
                            ],
                        };
                    }
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
            query: mock(async (queryConfig: any, params: any[]) => {
                const sqlText = extractSql(queryConfig);
                if (sqlText.includes('insert into "byoai_agent_memories"')) {
                    createdId = params?.[0];
                    return { rows: [] };
                }
                if (sqlText.includes('from "byoai_agent_memories"')) {
                    if (queryConfig.rowMode === "array") {
                        // [id, name, userId, mode, parentId, computerId, skillsPath, createdAt]
                        return {
                            rows: [
                                [
                                    createdId ?? "agent-pg-id",
                                    "Postgres Agent",
                                    "user-123",
                                    "interactive",
                                    null,
                                    null,
                                    null,
                                    new Date(),
                                ],
                            ],
                        };
                    }
                }
                if (sqlText.includes('from "byoai_transcripts"')) {
                    if (queryConfig.rowMode === "array") {
                        // select({ entry: byoaiTranscripts.entry }) -> [entry]
                        return {
                            rows: [
                                [
                                    {
                                        type: "message",
                                        role: "user",
                                        content: "Hello Postgres",
                                    },
                                ],
                            ],
                        };
                    }
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
