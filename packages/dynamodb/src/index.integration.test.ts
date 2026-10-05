import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import {
    DynamoDBAgentMemoryManager,
    DynamoDBComputerLifecycleManager,
    DynamoDBUserTokenManager,
} from "./index";

const shouldRunIntegration = process.env.RUN_INTEGRATION_TESTS === "true";

describe.skipIf(!shouldRunIntegration)(
    "DynamoDB Persistence Integration Tests (Testcontainers)",
    () => {
        let container: StartedTestContainer;
        let endpoint: string;
        let userTokenManager: DynamoDBUserTokenManager;
        let computerLifecycleManager: DynamoDBComputerLifecycleManager;
        let agentMemoryManager: DynamoDBAgentMemoryManager;

        beforeAll(async () => {
            container = await new GenericContainer("amazon/dynamodb-local:latest")
                .withExposedPorts(8000)
                .start();

            const port = container.getMappedPort(8000);
            const host = container.getHost();
            endpoint = `http://${host}:${port}`;

            userTokenManager = new DynamoDBUserTokenManager({ endpoint });
            computerLifecycleManager = new DynamoDBComputerLifecycleManager({
                endpoint,
            });
            agentMemoryManager = new DynamoDBAgentMemoryManager({ endpoint });

            await userTokenManager.init();
            await computerLifecycleManager.init();
            await agentMemoryManager.init();
        }, 120_000);

        afterAll(async () => {
            if (userTokenManager) await userTokenManager.destroy();
            if (computerLifecycleManager) await computerLifecycleManager.destroy();
            if (agentMemoryManager) await agentMemoryManager.destroy();
            if (container) await container.stop();
        });

        it("manages user tokens in live DynamoDB", async () => {
            await userTokenManager.setUserToken("user-dynamo-live", {
                accessToken: "tok-live-dynamo",
                tokenType: "Bearer",
                expiresAt: Date.now() + 60_000,
            });

            const token = await userTokenManager.getUserToken("user-dynamo-live");
            expect(token).toBeDefined();
            expect(token?.accessToken).toBe("tok-live-dynamo");

            await userTokenManager.clearUserToken("user-dynamo-live");
            const cleared = await userTokenManager.getUserToken("user-dynamo-live");
            expect(cleared).toBeUndefined();
        });

        it("manages computer lifecycles in live DynamoDB", async () => {
            const scope = {
                lifecycle: "server" as const,
                agentName: "agent-dynamo-live",
                userId: "u-live-dynamo",
                interactionId: "int-live-dynamo",
            };

            await computerLifecycleManager.setComputer(scope, {
                computerId: "comp-live-dynamo-1",
                lifecycle: "server",
                skillsPath: "/dynamo/skills",
            });

            const session = await computerLifecycleManager.getComputer(scope);
            expect(session?.computerId).toBe("comp-live-dynamo-1");
            expect(session?.skillsPath).toBe("/dynamo/skills");

            await computerLifecycleManager.removeComputer(scope);
            const removed = await computerLifecycleManager.getComputer(scope);
            expect(removed).toBeUndefined();
        });

        it("manages agent memories and transcripts in live DynamoDB", async () => {
            const id = await agentMemoryManager.createAgentMemoryEntry(
                "Live DynamoDB Agent",
                "u-live-dyn-1",
                "interactive",
            );

            await agentMemoryManager.addTranscriptEntries(id, [
                {
                    type: "message",
                    role: "user",
                    content: "Hello live DynamoDB",
                },
            ]);

            const agent = await agentMemoryManager.getAgentMemory(id);
            expect(agent.name).toBe("Live DynamoDB Agent");
            expect(agent.transcript.length).toBe(1);
            expect((agent.transcript[0] as any)?.content).toBe(
                "Hello live DynamoDB",
            );

            const all = await agentMemoryManager.getAllAgents();
            expect(all).toContain(id);
        });
    },
);
