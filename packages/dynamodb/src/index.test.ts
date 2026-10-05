import { describe, expect, it, mock } from "bun:test";
import {
    AgentMemoryManager,
    ComputerLifecycleManager,
    DynamoDBAgentMemoryManager,
    DynamoDBComputerLifecycleManager,
    DynamoDBUserTokenManager,
    UserTokenManager,
    createChatMemory,
    createComputerStore,
    createTokenStore,
} from "./index";

describe("DynamoDB Persistence Unit Tests - All 3 Managers", () => {
    it("exposes all 3 persistence managers and factories", () => {
        expect(DynamoDBAgentMemoryManager).toBeDefined();
        expect(DynamoDBUserTokenManager).toBeDefined();
        expect(DynamoDBComputerLifecycleManager).toBeDefined();

        expect(AgentMemoryManager).toBe(DynamoDBAgentMemoryManager);
        expect(UserTokenManager).toBe(DynamoDBUserTokenManager);
        expect(ComputerLifecycleManager).toBe(DynamoDBComputerLifecycleManager);

        const chat = createChatMemory({ endpoint: "http://localhost:8000" });
        const token = createTokenStore({ endpoint: "http://localhost:8000" });
        const comp = createComputerStore({ endpoint: "http://localhost:8000" });

        expect(chat).toBeInstanceOf(DynamoDBAgentMemoryManager);
        expect(token).toBeInstanceOf(DynamoDBUserTokenManager);
        expect(comp).toBeInstanceOf(DynamoDBComputerLifecycleManager);
    });

    it("DynamoDBUserTokenManager sets and gets tokens", async () => {
        const mockClient = {
            send: mock(async (cmd: any) => {
                if (cmd.input?.Key?.userId === "u-dynamo") {
                    return {
                        Item: {
                            userId: "u-dynamo",
                            accessToken: "dynamo-tok-1",
                            tokenType: "Bearer",
                            expiresAt: Date.now() + 100_000,
                            extraHeaders: { "X-Cloud": "aws" },
                        },
                    };
                }
                return {};
            }),
            destroy: mock(() => {}),
        } as any;

        const tokenStore = new DynamoDBUserTokenManager(mockClient);
        await tokenStore.setUserToken("u-dynamo", {
            accessToken: "dynamo-tok-1",
            tokenType: "Bearer",
        });

        const token = await tokenStore.getUserToken("u-dynamo");
        expect(token).toBeDefined();
        expect(token?.accessToken).toBe("dynamo-tok-1");
        expect(token?.extraHeaders).toEqual({ "X-Cloud": "aws" });
    });

    it("DynamoDBComputerLifecycleManager saves and retrieves session records", async () => {
        const mockClient = {
            send: mock(async (cmd: any) => {
                if (cmd.input?.Key?.key?.includes("user:agent-dyn:u-dyn")) {
                    return {
                        Item: {
                            key: "user:agent-dyn:u-dyn",
                            computerId: "comp-dyn-1",
                            lifecycle: "user",
                            skillsPath: "/workspace/skills",
                            createdAt: 1700000000000,
                        },
                    };
                }
                return {};
            }),
            destroy: mock(() => {}),
        } as any;

        const compStore = new DynamoDBComputerLifecycleManager(mockClient);
        const scope = {
            lifecycle: "user" as const,
            agentName: "agent-dyn",
            userId: "u-dyn",
            interactionId: "int-dyn",
        };

        await compStore.setComputer(scope, {
            computerId: "comp-dyn-1",
            lifecycle: "user",
        });

        const record = await compStore.getComputer(scope);
        expect(record?.computerId).toBe("comp-dyn-1");
        expect(record?.skillsPath).toBe("/workspace/skills");
    });

    it("DynamoDBAgentMemoryManager creates memory, adds transcripts, and reads memory", async () => {
        let savedId: string | undefined;
        const mockClient = {
            send: mock(async (cmd: any) => {
                if (cmd.input?.Item?.name === "Dynamo Agent") {
                    savedId = cmd.input.Item.id;
                    return {};
                }
                if (cmd.input?.Key?.id) {
                    return {
                        Item: {
                            id: savedId ?? "agent-dyn-id",
                            name: "Dynamo Agent",
                            userId: "user-dyn-123",
                            mode: "interactive",
                            transcript: [
                                {
                                    type: "message",
                                    role: "user",
                                    content: "Hello DynamoDB",
                                },
                            ],
                            createdAt: Date.now(),
                        },
                    };
                }
                return {};
            }),
            destroy: mock(() => {}),
        } as any;

        const memoryManager = new DynamoDBAgentMemoryManager(mockClient);
        const id = await memoryManager.createAgentMemoryEntry(
            "Dynamo Agent",
            "user-dyn-123",
            "interactive",
        );

        expect(id).toBeDefined();

        await memoryManager.addTranscriptEntries(id, [
            {
                type: "message",
                role: "user",
                content: "Hello DynamoDB",
            },
        ]);

        const memory = await memoryManager.getAgentMemory(id);
        expect(memory.name).toBe("Dynamo Agent");
        expect(memory.userId).toBe("user-dyn-123");
        expect(memory.transcript.length).toBe(1);
        expect(memory.transcript[0]?.type).toBe("message");
    });
});
