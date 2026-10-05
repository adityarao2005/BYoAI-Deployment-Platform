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
                    return [
                        [
                            {
                                user_id: "user-mysql",
                                access_token: "mysql-tok-1",
                                token_type: "Bearer",
                                expires_at: Date.now() + 100_000,
                                extra_headers: { "X-Env": "mysql" },
                            },
                        ],
                    ];
                }
                return [[]];
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
                    return [
                        [
                            {
                                key: "user:agent-mysql:u-mysql",
                                computer_id: "comp-mysql-1",
                                lifecycle: "user",
                                skills_path: "/workspace/skills",
                                created_at: 1700000000000,
                            },
                        ],
                    ];
                }
                return [[]];
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
                    return [[]];
                }
                if (sqlText.includes("from `byoai_agent_memories`")) {
                    return [
                        [
                            {
                                id: createdId ?? "agent-mysql-id",
                                name: "MySQL Agent",
                                user_id: "user-my-123",
                                mode: "interactive",
                                parent_id: null,
                                computer_id: null,
                                skills_path: null,
                                created_at: new Date(),
                            },
                        ],
                    ];
                }
                if (sqlText.includes("from `byoai_transcripts`")) {
                    return [
                        [
                            {
                                entry: {
                                    type: "message",
                                    role: "user",
                                    content: "Hello MySQL",
                                },
                            },
                        ],
                    ];
                }
                return [[]];
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
