import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import {
    MySqlAgentMemoryManager,
    MySqlComputerLifecycleManager,
    MySqlUserTokenManager,
} from "./index";

const shouldRunIntegration = process.env.RUN_INTEGRATION_TESTS === "true";

describe.skipIf(!shouldRunIntegration)(
    "MySQL Persistence Integration Tests (Testcontainers)",
    () => {
        let container: StartedTestContainer;
        let connectionUrl: string;
        let userTokenManager: MySqlUserTokenManager;
        let computerLifecycleManager: MySqlComputerLifecycleManager;
        let agentMemoryManager: MySqlAgentMemoryManager;

        beforeAll(async () => {
            container = await new GenericContainer("mysql:8.0")
                .withEnvironment({
                    MYSQL_ROOT_PASSWORD: "testpassword",
                    MYSQL_DATABASE: "testdb",
                })
                .withExposedPorts(3306)
                .start();

            const port = container.getMappedPort(3306);
            const host = container.getHost();
            connectionUrl = `mysql://root:testpassword@${host}:${port}/testdb`;

            userTokenManager = new MySqlUserTokenManager({ url: connectionUrl });
            computerLifecycleManager = new MySqlComputerLifecycleManager({
                url: connectionUrl,
            });
            agentMemoryManager = new MySqlAgentMemoryManager({ url: connectionUrl });

            await userTokenManager.init();
        }, 120_000);

        afterAll(async () => {
            if (userTokenManager) await userTokenManager.destroy();
            if (computerLifecycleManager) await computerLifecycleManager.destroy();
            if (agentMemoryManager) await agentMemoryManager.destroy();
            if (container) await container.stop();
        });

        it("manages user tokens in live MySQL", async () => {
            await userTokenManager.setUserToken("user-mysql-live", {
                accessToken: "tok-live-mysql",
                tokenType: "Bearer",
                expiresAt: Date.now() + 60_000,
            });

            const token = await userTokenManager.getUserToken("user-mysql-live");
            expect(token).toBeDefined();
            expect(token?.accessToken).toBe("tok-live-mysql");

            await userTokenManager.clearUserToken("user-mysql-live");
            const cleared = await userTokenManager.getUserToken("user-mysql-live");
            expect(cleared).toBeUndefined();
        });

        it("manages computer lifecycles in live MySQL", async () => {
            const scope = {
                lifecycle: "server" as const,
                agentName: "agent-mysql-live",
                userId: "u-live-mysql",
                interactionId: "int-live-mysql",
            };

            await computerLifecycleManager.setComputer(scope, {
                computerId: "comp-live-mysql-1",
                lifecycle: "server",
                skillsPath: "/mysql/skills",
            });

            const session = await computerLifecycleManager.getComputer(scope);
            expect(session?.computerId).toBe("comp-live-mysql-1");
            expect(session?.skillsPath).toBe("/mysql/skills");

            await computerLifecycleManager.removeComputer(scope);
            const removed = await computerLifecycleManager.getComputer(scope);
            expect(removed).toBeUndefined();
        });

        it("manages agent memories and transcripts in live MySQL", async () => {
            const id = await agentMemoryManager.createAgentMemoryEntry(
                "Live MySQL Agent",
                "u-live-my-1",
                "interactive",
            );

            await agentMemoryManager.addTranscriptEntries(id, [
                {
                    type: "message",
                    role: "user",
                    content: "Hello live MySQL",
                },
            ]);

            const agent = await agentMemoryManager.getAgentMemory(id);
            expect(agent.name).toBe("Live MySQL Agent");
            expect(agent.transcript.length).toBe(1);
            expect((agent.transcript[0] as any)?.content).toBe("Hello live MySQL");

            const all = await agentMemoryManager.getAllAgents();
            expect(all).toContain(id);
        });
    },
);
