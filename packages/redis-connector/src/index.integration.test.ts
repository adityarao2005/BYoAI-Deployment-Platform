import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { RedisAgentCommunicator } from "./index";

const shouldRunIntegration =
    process.env.RUN_INTEGRATION_TESTS === "true" ||
    process.env.RUN_INTEGRATION_TESTS === "1";

describe.skipIf(!shouldRunIntegration)(
    "RedisAgentCommunicator Integration Tests (Testcontainers)",
    () => {
        let redisContainer: StartedTestContainer;
        let redisPort: number;
        let redisHost: string;

        beforeAll(async () => {
            redisContainer = await new GenericContainer("redis:7-alpine")
                .withExposedPorts(6379)
                .start();
            redisHost = redisContainer.getHost();
            redisPort = redisContainer.getMappedPort(6379);
        }, 60000);

        afterAll(async () => {
            if (redisContainer) {
                await redisContainer.stop();
            }
        });

        it("dispatches telemetry broadcast to all instances and queue tasks to one instance", async () => {
            // Spin up two independent communicator instances sharing the same Redis broker
            const instance1 = new RedisAgentCommunicator({
                host: redisHost,
                port: redisPort,
                consumerName: "worker-1",
            });

            const instance2 = new RedisAgentCommunicator({
                host: redisHost,
                port: redisPort,
                consumerName: "worker-2",
            });

            await instance1.init();
            await instance2.init();

            // 1. Telemetry Broadcast: Both instances should receive the message
            const broadcastResults: { instance1: any[]; instance2: any[] } = {
                instance1: [],
                instance2: [],
            };

            instance1.on("agent:message", (p) => {
                broadcastResults.instance1.push(p);
            });
            instance2.on("agent:message", (p) => {
                broadcastResults.instance2.push(p);
            });

            // Allow Redis subscribe to propagate
            await new Promise((r) => setTimeout(r, 200));

            await instance1.emit("agent:message", {
                agentId: "agent-100",
                content: "Telemetry Broadcast Test",
            });

            // Wait for propagation
            await new Promise((r) => setTimeout(r, 400));

            expect(broadcastResults.instance1.length).toBe(1);
            expect(broadcastResults.instance2.length).toBe(1);
            expect(broadcastResults.instance1[0].content).toBe(
                "Telemetry Broadcast Test",
            );
            expect(broadcastResults.instance2[0].content).toBe(
                "Telemetry Broadcast Test",
            );

            // 2. Queue Task: Only ONE instance should receive and process the work
            const queueResults: { instance1: any[]; instance2: any[] } = {
                instance1: [],
                instance2: [],
            };

            instance1.on("user:message", (p) => {
                queueResults.instance1.push(p);
            });
            instance2.on("user:message", (p) => {
                queueResults.instance2.push(p);
            });

            await instance1.emit("user:message", {
                agentId: "agent-100",
                content: "Single Worker Command",
            });

            // Wait for worker loop to read and acknowledge
            await new Promise((r) => setTimeout(r, 800));

            const totalProcessed =
                queueResults.instance1.length + queueResults.instance2.length;
            expect(totalProcessed).toBe(1);

            await instance1.destroy();
            await instance2.destroy();
        }, 20000);
    },
);
