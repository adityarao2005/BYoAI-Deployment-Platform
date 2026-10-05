import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { RabbitMQAgentCommunicator } from "./index";

const shouldRunIntegration =
    process.env.RUN_INTEGRATION_TESTS === "true" ||
    process.env.RUN_INTEGRATION_TESTS === "1";

describe.skipIf(!shouldRunIntegration)(
    "RabbitMQAgentCommunicator Integration Tests (Testcontainers)",
    () => {
        let rabbitContainer: StartedTestContainer;
        let amqpUrl: string;

        beforeAll(async () => {
            rabbitContainer = await new GenericContainer("rabbitmq:3-alpine")
                .withExposedPorts(5672)
                .start();
            const host = rabbitContainer.getHost();
            const port = rabbitContainer.getMappedPort(5672);
            amqpUrl = `amqp://${host}:${port}`;
        }, 90000);

        afterAll(async () => {
            if (rabbitContainer) {
                await rabbitContainer.stop();
            }
        });

        it("dispatches telemetry broadcast to all instances and queue tasks to one instance", async () => {
            const instance1 = new RabbitMQAgentCommunicator({ url: amqpUrl });
            const instance2 = new RabbitMQAgentCommunicator({ url: amqpUrl });

            await instance1.init();
            await instance2.init();

            // 1. Broadcast Telemetry Test
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

            await new Promise((r) => setTimeout(r, 300));

            await instance1.emit("agent:message", {
                agentId: "agent-rabbit",
                content: "Fanout Broadcast Msg",
            });

            await new Promise((r) => setTimeout(r, 500));

            expect(broadcastResults.instance1.length).toBe(1);
            expect(broadcastResults.instance2.length).toBe(1);
            expect(broadcastResults.instance1[0].content).toBe(
                "Fanout Broadcast Msg",
            );
            expect(broadcastResults.instance2[0].content).toBe(
                "Fanout Broadcast Msg",
            );

            // 2. Queue Task Test (Competing Consumers)
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
                agentId: "agent-rabbit",
                content: "Competing Consumer Work",
            });

            await new Promise((r) => setTimeout(r, 600));

            const total =
                queueResults.instance1.length + queueResults.instance2.length;
            expect(total).toBe(1);

            await instance1.destroy();
            await instance2.destroy();
        }, 30000);
    },
);
