import { describe, expect, it, mock } from "bun:test";
import {
    AgentMemoryManager,
    ComputerLifecycleManager,
    MongoAgentMemoryManager,
    MongoComputerLifecycleManager,
    MongoUserTokenManager,
    UserTokenManager,
    createChatMemory,
    createComputerStore,
    createTokenStore,
} from "./index";

describe("MongoDB Persistence Unit Tests - All 3 Managers", () => {
    it("exposes all 3 persistence managers and factories", () => {
        expect(MongoAgentMemoryManager).toBeDefined();
        expect(MongoUserTokenManager).toBeDefined();
        expect(MongoComputerLifecycleManager).toBeDefined();

        expect(AgentMemoryManager).toBe(MongoAgentMemoryManager);
        expect(UserTokenManager).toBe(MongoUserTokenManager);
        expect(ComputerLifecycleManager).toBe(MongoComputerLifecycleManager);

        const chat = createChatMemory({ url: "mongodb://localhost:27017/db" });
        const token = createTokenStore({ url: "mongodb://localhost:27017/db" });
        const comp = createComputerStore({ url: "mongodb://localhost:27017/db" });

        expect(chat).toBeInstanceOf(MongoAgentMemoryManager);
        expect(token).toBeInstanceOf(MongoUserTokenManager);
        expect(comp).toBeInstanceOf(MongoComputerLifecycleManager);
    });

    it("MongoUserTokenManager sets and gets tokens", async () => {
        const mockCollection = {
            createIndex: mock(async () => "index"),
            findOne: mock(async () => ({
                userId: "user-mongo-1",
                accessToken: "tok-mongo",
                tokenType: "Bearer",
                expiresAt: Date.now() + 60_000,
            })),
            updateOne: mock(async () => ({ matchedCount: 1 })),
            deleteOne: mock(async () => ({ deletedCount: 1 })),
        };

        const mockClient = {
            connect: mock(async () => {}),
            db: mock(() => ({
                collection: mock(() => mockCollection),
            })),
            close: mock(async () => {}),
        } as any;

        const tokenStore = new MongoUserTokenManager({
            client: mockClient,
            dbName: "test_db",
        });

        await tokenStore.setUserToken("user-mongo-1", {
            accessToken: "tok-mongo",
            tokenType: "Bearer",
        });

        expect(mockCollection.updateOne).toHaveBeenCalled();

        const token = await tokenStore.getUserToken("user-mongo-1");
        expect(token).toBeDefined();
        expect(token?.accessToken).toBe("tok-mongo");

        await tokenStore.clearUserToken("user-mongo-1");
        expect(mockCollection.deleteOne).toHaveBeenCalled();
    });

    it("MongoComputerLifecycleManager manages computer records", async () => {
        const mockCollection = {
            createIndex: mock(async () => "index"),
            findOne: mock(async () => ({
                key: "user:agent-m:user-1",
                computerId: "comp-mongo-1",
                lifecycle: "user",
            })),
            updateOne: mock(async () => ({ matchedCount: 1 })),
            deleteOne: mock(async () => ({ deletedCount: 1 })),
            deleteMany: mock(async () => ({ deletedCount: 5 })),
        };

        const mockClient = {
            connect: mock(async () => {}),
            db: mock(() => ({
                collection: mock(() => mockCollection),
            })),
            close: mock(async () => {}),
        } as any;

        const compStore = new MongoComputerLifecycleManager({
            client: mockClient,
            dbName: "test_db",
        });

        const scope = {
            lifecycle: "user" as const,
            agentName: "agent-m",
            userId: "user-1",
            interactionId: "int-1",
        };

        await compStore.setComputer(scope, {
            computerId: "comp-mongo-1",
            lifecycle: "user",
        });

        expect(mockCollection.updateOne).toHaveBeenCalled();

        const record = await compStore.getComputer(scope);
        expect(record?.computerId).toBe("comp-mongo-1");

        await compStore.removeComputer(scope);
        expect(mockCollection.deleteOne).toHaveBeenCalled();
    });

    it("MongoAgentMemoryManager manages memories and transcripts", async () => {
        let insertedDoc: any;
        const mockCollection = {
            createIndex: mock(async () => "index"),
            insertOne: mock(async (doc: any) => {
                insertedDoc = doc;
                return { insertedId: doc._id };
            }),
            findOne: mock(async () => ({
                id: insertedDoc?._id ?? "agent-m-id",
                name: "Mongo Agent",
                userId: "user-m",
                mode: "interactive",
                transcript: [
                    {
                        type: "user_message",
                        id: "msg-m-1",
                        text: "Hello Mongo",
                    },
                ],
            })),
            updateOne: mock(async () => ({ matchedCount: 1 })),
            find: mock(() => ({
                toArray: mock(async () => [{ id: "agent-m-id" }]),
            })),
        };

        const mockClient = {
            connect: mock(async () => {}),
            db: mock(() => ({
                collection: mock(() => mockCollection),
            })),
            close: mock(async () => {}),
        } as any;

        const memoryManager = new MongoAgentMemoryManager({
            client: mockClient,
            dbName: "test_db",
        });

        const id = await memoryManager.createAgentMemoryEntry(
            "Mongo Agent",
            "user-m",
            "interactive",
        );
        expect(id).toBeDefined();

        await memoryManager.addTranscriptEntries(id, [
            {
                type: "message",
                role: "user",
                content: "Hello Mongo",
            },
        ]);

        const memory = await memoryManager.getAgentMemory(id);
        expect(memory.name).toBe("Mongo Agent");
        expect(memory.transcript.length).toBe(1);

        const all = await memoryManager.getAllAgents();
        expect(all).toContain("agent-m-id");
    });
});
