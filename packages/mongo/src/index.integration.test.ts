import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import {
    MongoAgentMemoryManager,
    MongoComputerLifecycleManager,
    MongoUserTokenManager,
} from "./index";

const shouldRunIntegration =
    process.env.RUN_INTEGRATION_TESTS === "true" ||
    process.env.RUN_INTEGRATION_TESTS === "1";

describe.skipIf(!shouldRunIntegration)(
    "MongoDB Persistence Integration Tests (Testcontainers)",
    () => {
        let mongoContainer: StartedTestContainer;
        let mongoPort: number;
        let mongoHost: string;
        let connectionUrl: string;

        beforeAll(async () => {
            mongoContainer = await new GenericContainer("mongo:7")
                .withExposedPorts(27017)
                .start();

            mongoHost = mongoContainer.getHost();
            mongoPort = mongoContainer.getMappedPort(27017);
            connectionUrl = `mongodb://${mongoHost}:${mongoPort}`;
        }, 60000);

        afterAll(async () => {
            if (mongoContainer) {
                await mongoContainer.stop();
            }
        });

        it("manages user tokens in live MongoDB", async () => {
            const tokenStore = new MongoUserTokenManager({
                url: connectionUrl,
                dbName: "byoai_integ_test",
            });
            await tokenStore.init();

            await tokenStore.setUserToken("user-mongo-live", {
                accessToken: "live-mongo-tok-123",
                tokenType: "Bearer",
                expiresAt: Date.now() + 60_000,
            });

            const loaded = await tokenStore.getUserToken("user-mongo-live");
            expect(loaded).toBeDefined();
            expect(loaded?.accessToken).toBe("live-mongo-tok-123");

            await tokenStore.clearUserToken("user-mongo-live");
            const afterClear = await tokenStore.getUserToken("user-mongo-live");
            expect(afterClear).toBeUndefined();

            await tokenStore.destroy();
        });

        it("manages computer lifecycles in live MongoDB", async () => {
            const compStore = new MongoComputerLifecycleManager({
                url: connectionUrl,
                dbName: "byoai_integ_test",
            });
            await compStore.init();

            const scope = {
                lifecycle: "user" as const,
                agentName: "agent-m-live",
                userId: "u-live-1",
                interactionId: "int-live-1",
            };

            await compStore.setComputer(scope, {
                computerId: "container-mongo-1",
                lifecycle: "user",
            });

            const rec = await compStore.getComputer(scope);
            expect(rec).toBeDefined();
            expect(rec?.computerId).toBe("container-mongo-1");

            await compStore.removeComputer(scope);
            const afterRemove = await compStore.getComputer(scope);
            expect(afterRemove).toBeUndefined();

            await compStore.destroy();
        });

        it("manages agent memories and transcripts in live MongoDB", async () => {
            const memoryManager = new MongoAgentMemoryManager({
                url: connectionUrl,
                dbName: "byoai_integ_test",
            });
            await memoryManager.init();

            const agentId = await memoryManager.createAgentMemoryEntry(
                "Live Mongo Agent",
                "user-live-mongo",
                "interactive",
            );
            expect(agentId).toBeDefined();

            await memoryManager.addTranscriptEntries(agentId, [
                {
                    type: "message",
                    role: "user",
                    content: "Hello live Mongo",
                },
            ]);

            const memory = await memoryManager.getAgentMemory(agentId);
            expect(memory.name).toBe("Live Mongo Agent");
            expect(memory.transcript.length).toBe(1);

            const allAgents = await memoryManager.getAllAgents();
            expect(allAgents).toContain(agentId);

            await memoryManager.destroy();
        });
    },
);
