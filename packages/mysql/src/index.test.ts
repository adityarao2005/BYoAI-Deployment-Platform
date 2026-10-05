import { describe, expect, it, mock } from "bun:test";
import {
    AgentMemoryManager,
    ComputerLifecycleManager,
    MySqlAgentMemoryManager,
    MySqlComputerLifecycleManager,
    MySqlUserTokenManager,
    UserTokenManager,
    createChatMemory,
    createComputerStore,
    createTokenStore,
} from "./index";

function extractSql(sqlArg: any): string {
    if (typeof sqlArg === "string") return sqlArg;
    return sqlArg?.sql ?? "";
}

describe("MySQL Persistence Unit Tests - All 3 Managers", () => {
    it("exposes all 3 persistence managers and factories", () => {
        expect(MySqlAgentMemoryManager).toBeDefined();
        expect(MySqlUserTokenManager).toBeDefined();
        expect(MySqlComputerLifecycleManager).toBeDefined();

        expect(AgentMemoryManager).toBe(MySqlAgentMemoryManager);
        expect(UserTokenManager).toBe(MySqlUserTokenManager);
        expect(ComputerLifecycleManager).toBe(MySqlComputerLifecycleManager);

        const chat = createChatMemory({ url: "mysql://root:pass@localhost:3306/db" });
        const token = createTokenStore({ url: "mysql://root:pass@localhost:3306/db" });
        const comp = createComputerStore({ url: "mysql://root:pass@localhost:3306/db" });

        expect(chat).toBeInstanceOf(MySqlAgentMemoryManager);
        expect(token).toBeInstanceOf(MySqlUserTokenManager);
        expect(comp).toBeInstanceOf(MySqlComputerLifecycleManager);
    });

    it("MySqlUserTokenManager sets and gets tokens", async () => {
        const mockPool = {
            getConnection: mock(async () => ({
                query: mock(async () => []),
                release: mock(() => {}),
            })),
            query: mock(async (queryConfig: any) => {
                const sqlText = extractSql(queryConfig);
                if (sqlText.includes("byoai_user_tokens")) {
                    if (queryConfig.rowsAsArray) {
                        // [userId, accessToken, tokenType, expiresAt, extraHeaders, updatedAt]
                        return [
                            [
                                [
                                    "user-mysql",
                                    "mysql-tok-1",
                                    "Bearer",
                                    Date.now() + 100_000,
                                    { "X-Env": "mysql" },
                                    new Date(),
                                ],
                            ],
                            [],
                        ];
                    }
                }
                return [[], []];
            }),
            end: mock(async () => {}),
        } as any;

        const tokenStore = new MySqlUserTokenManager(mockPool);
        await tokenStore.setUserToken("user-mysql", {
            accessToken: "mysql-tok-1",
            tokenType: "Bearer",
        });

        const token = await tokenStore.getUserToken("user-mysql");
        expect(token).toBeDefined();
        expect(token?.accessToken).toBe("mysql-tok-1");
        expect(token?.extraHeaders).toEqual({ "X-Env": "mysql" });
    });

    it("MySqlComputerLifecycleManager saves and retrieves session records", async () => {
        const mockPool = {
            getConnection: mock(async () => ({
                query: mock(async () => []),
                release: mock(() => {}),
            })),
            query: mock(async (queryConfig: any) => {
                const sqlText = extractSql(queryConfig);
                if (sqlText.includes("byoai_computer_sessions")) {
                    if (queryConfig.rowsAsArray) {
                        // [key, computerId, lifecycle, skillsPath, createdAt]
                        return [
                            [
                                [
                                    "user:agent-mysql:u-mysql",
                                    "comp-mysql-1",
                                    "user",
                                    "/workspace/skills",
                                    1700000000000,
                                ],
                            ],
                            [],
                        ];
                    }
                }
                return [[], []];
            }),
            end: mock(async () => {}),
        } as any;

        const compStore = new MySqlComputerLifecycleManager(mockPool);
        const scope = {
            lifecycle: "user" as const,
            agentName: "agent-mysql",
            userId: "u-mysql",
            interactionId: "int-mysql",
        };

        await compStore.setComputer(scope, {
            computerId: "comp-mysql-1",
            lifecycle: "user",
        });

        const record = await compStore.getComputer(scope);
        expect(record?.computerId).toBe("comp-mysql-1");
        expect(record?.skillsPath).toBe("/workspace/skills");
    });

    it("MySqlAgentMemoryManager creates memory, adds transcripts, and reads memory", async () => {
        let createdId: string | undefined;
        const mockPool = {
            getConnection: mock(async () => ({
                query: mock(async () => []),
                release: mock(() => {}),
            })),
            query: mock(async (queryConfig: any, params: any[]) => {
                const sqlText = extractSql(queryConfig);
                if (sqlText.includes("insert into `byoai_agent_memories`")) {
                    createdId = params?.[0];
                    return [[], []];
                }
                if (sqlText.includes("from `byoai_agent_memories`")) {
                    if (queryConfig.rowsAsArray) {
                        // [id, name, userId, mode, parentId, computerId, skillsPath, createdAt]
                        return [
                            [
                                [
                                    createdId ?? "agent-mysql-id",
                                    "MySQL Agent",
                                    "user-my-123",
                                    "interactive",
                                    null,
                                    null,
                                    null,
                                    new Date(),
                                ],
                            ],
                            [],
                        ];
                    }
                }
                if (sqlText.includes("from `byoai_transcripts`")) {
                    if (queryConfig.rowsAsArray) {
                        return [
                            [
                                [
                                    {
                                        type: "message",
                                        role: "user",
                                        content: "Hello MySQL",
                                    },
                                ],
                            ],
                            [],
                        ];
                    }
                }
                return [[], []];
            }),
            end: mock(async () => {}),
        } as any;

        const memoryManager = new MySqlAgentMemoryManager(mockPool);
        const id = await memoryManager.createAgentMemoryEntry(
            "MySQL Agent",
            "user-my-123",
            "interactive",
        );

        expect(id).toBeDefined();

        await memoryManager.addTranscriptEntries(id, [
            {
                type: "message",
                role: "user",
                content: "Hello MySQL",
            },
        ]);

        const memory = await memoryManager.getAgentMemory(id);
        expect(memory.name).toBe("MySQL Agent");
        expect(memory.userId).toBe("user-my-123");
        expect(memory.transcript.length).toBe(1);
        expect(memory.transcript[0]?.type).toBe("message");
    });
});
