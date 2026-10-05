import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { KafkaAgentCommunicator } from "./index";

const shouldRunIntegration =
    process.env.RUN_INTEGRATION_TESTS === "true" ||
    process.env.RUN_INTEGRATION_TESTS === "1";

describe.skipIf(!shouldRunIntegration)(
    "KafkaAgentCommunicator Integration Tests (Testcontainers)",
    () => {
        let kafkaContainer: StartedTestContainer;
        let brokerAddress: string;

        beforeAll(async () => {
            kafkaContainer = await new GenericContainer("apache/kafka:latest")
                .withExposedPorts(9092)
                .withEnvironment({
                    KAFKA_NODE_ID: "1",
                    KAFKA_PROCESS_ROLES: "broker,controller",
                    KAFKA_LISTENERS: "PLAINTEXT://:9092,CONTROLLER://:9093",
                    KAFKA_ADVERTISED_LISTENERS: "PLAINTEXT://localhost:9092",
                    KAFKA_CONTROLLER_LISTENER_NAMES: "CONTROLLER",
                    KAFKA_LISTENER_SECURITY_PROTOCOL_MAP:
                        "CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT",
                    KAFKA_CONTROLLER_QUORUM_VOTERS: "1@localhost:9093",
                    KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: "1",
                    KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR: "1",
                    KAFKA_TRANSACTION_STATE_LOG_MIN_ISR: "1",
                    KAFKA_GROUP_INITIAL_REBALANCE_DELAY_MS: "0",
                    KAFKA_NUM_PARTITIONS: "3",
                })
                .start();

            const host = kafkaContainer.getHost();
            const port = kafkaContainer.getMappedPort(9092);
            brokerAddress = `${host}:${port}`;
        }, 120000);

        afterAll(async () => {
            if (kafkaContainer) {
                await kafkaContainer.stop();
            }
        });

        it("dispatches telemetry broadcast to all instances and queue tasks to one instance", async () => {
            const instance1 = new KafkaAgentCommunicator({
                brokers: [brokerAddress],
                instanceId: "inst-1",
            });
            const instance2 = new KafkaAgentCommunicator({
                brokers: [brokerAddress],
                instanceId: "inst-2",
            });

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

            await new Promise((r) => setTimeout(r, 2000));

            await instance1.emit("agent:message", {
                agentId: "agent-kafka",
                content: "Kafka Broadcast Telemetry",
            });

            await new Promise((r) => setTimeout(r, 3000));

            expect(broadcastResults.instance1.length).toBe(1);
            expect(broadcastResults.instance2.length).toBe(1);

            // 2. Queue Task Test (Partitioned Competing Consumers)
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
                agentId: "agent-kafka",
                content: "Single Worker Task",
            });

            await new Promise((r) => setTimeout(r, 3000));

            const total =
                queueResults.instance1.length + queueResults.instance2.length;
            expect(total).toBe(1);

            await instance1.destroy();
            await instance2.destroy();
        }, 45000);
    },
);
