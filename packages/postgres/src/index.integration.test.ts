import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import {
    PostgresAgentMemoryManager,
    PostgresComputerLifecycleManager,
    PostgresUserTokenManager,
} from "./index";

const shouldRunIntegration =
    process.env.RUN_INTEGRATION_TESTS === "true" ||
    process.env.RUN_INTEGRATION_TESTS === "1";

describe.skipIf(!shouldRunIntegration)(
    "Postgres Persistence Integration Tests (Testcontainers)",
    () => {
        let pgContainer: StartedTestContainer;
        let pgPort: number;
        let pgHost: string;
        let connectionUrl: string;

        beforeAll(async () => {
            pgContainer = await new GenericContainer("postgres:16-alpine")
                .withEnvironment({
                    POSTGRES_USER: "testuser",
                    POSTGRES_PASSWORD: "testpassword",
                    POSTGRES_DB: "byoai_test",
                })
                .withExposedPorts(5432)
                .start();

            pgHost = pgContainer.getHost();
            pgPort = pgContainer.getMappedPort(5432);
            connectionUrl = `postgresql://testuser:testpassword@${pgHost}:${pgPort}/byoai_test`;
        }, 60000);

        afterAll(async () => {
            if (pgContainer) {
                await pgContainer.stop();
            }
        });

        it("manages user tokens in live PostgreSQL", async () => {
            const tokenStore = new PostgresUserTokenManager({ url: connectionUrl });
            await tokenStore.init();

            await tokenStore.setUserToken("user-pg-live", {
                accessToken: "tok-pg-live-123",
                tokenType: "Bearer",
                expiresAt: Date.now() + 60_000,
            });

            const loaded = await tokenStore.getUserToken("user-pg-live");
            expect(loaded).toBeDefined();
            expect(loaded?.accessToken).toBe("tok-pg-live-123");

            await tokenStore.clearUserToken("user-pg-live");
            const afterClear = await tokenStore.getUserToken("user-pg-live");
            expect(afterClear).toBeUndefined();

            await tokenStore.destroy();
        });

        it("manages computer lifecycles in live PostgreSQL", async () => {
            const compStore = new PostgresComputerLifecycleManager({
                url: connectionUrl,
            });
            await compStore.init();

            const scope = {
                lifecycle: "server" as const,
                agentName: "agent-pg-live",
                userId: "user-1",
                interactionId: "int-1",
            };

            await compStore.setComputer(scope, {
                computerId: "docker-pg-container-1",
                lifecycle: "server",
            });

            const rec = await compStore.getComputer(scope);
            expect(rec).toBeDefined();
            expect(rec?.computerId).toBe("docker-pg-container-1");

            await compStore.removeComputer(scope);
            const afterRemove = await compStore.getComputer(scope);
            expect(afterRemove).toBeUndefined();

            await compStore.destroy();
        });

        it("manages agent memories and transcripts in live PostgreSQL", async () => {
            const memoryManager = new PostgresAgentMemoryManager({
                url: connectionUrl,
            });
            await memoryManager.init();

            const agentId = await memoryManager.createAgentMemoryEntry(
                "Live PG Agent",
                "user-live-pg",
                "interactive",
            );
            expect(agentId).toBeDefined();

            await memoryManager.addTranscriptEntries(agentId, [
                {
                    type: "message",
                    role: "user",
                    content: "Hello live PG",
                },
                {
                    type: "message",
                    role: "assistant",
                    content: "Hello user",
                },
            ]);

            const memory = await memoryManager.getAgentMemory(agentId);
            expect(memory.name).toBe("Live PG Agent");
            expect(memory.userId).toBe("user-live-pg");
            expect(memory.transcript.length).toBe(2);

            const allAgents = await memoryManager.getAllAgents();
            expect(allAgents).toContain(agentId);

            await memoryManager.destroy();
        });
    },
);
