import { describe, expect, it, mock } from "bun:test";
import { KafkaAgentCommunicator } from "./index";

describe("KafkaAgentCommunicator Unit Tests", () => {
    it("initializes with default options", () => {
        const comm = new KafkaAgentCommunicator();
        expect(comm.brokers).toEqual(["127.0.0.1:9092"]);
        expect(comm.clientId).toBe("agentic-harness");
        expect(comm.telemetryTopic).toBe("agentic-telemetry");
        expect(comm.commandsTopic).toBe("agentic-commands");
        expect(comm.consumerGroup).toBe("agentic-workers");
        expect(comm.telemetryGroup).toMatch(/^agentic-telemetry-/);
    });

    it("parses custom configuration properties", () => {
        const comm = new KafkaAgentCommunicator({
            BOOTSTRAP_SERVERS: "broker1:9092, broker2:9092",
            CLIENT_ID: "my-app",
            TELEMETRY_TOPIC: "custom-telemetry",
            COMMANDS_TOPIC: "custom-commands",
            CONSUMER_GROUP: "custom-workers",
            INSTANCE_ID: "inst-42",
        });
        expect(comm.brokers).toEqual(["broker1:9092", "broker2:9092"]);
        expect(comm.clientId).toBe("my-app");
        expect(comm.telemetryTopic).toBe("custom-telemetry");
        expect(comm.commandsTopic).toBe("custom-commands");
        expect(comm.consumerGroup).toBe("custom-workers");
        expect(comm.telemetryGroup).toBe("agentic-telemetry-inst-42");
    });

    it("routes emission to commands topic with partitionKey and telemetry topic for broadcast", async () => {
        const comm = new KafkaAgentCommunicator();

        const sendCalls: any[] = [];
        (comm as any).producer = {
            send: mock(async (record: any) => {
                sendCalls.push(record);
                return [];
            }),
        };

        // 1. Command event -> sends to commandsTopic with key=agentId
        await comm.emit("user:message", {
            agentId: "agent-kfk",
            content: "Kafka Command",
        });

        expect(sendCalls).toHaveLength(1);
        expect(sendCalls[0].topic).toBe("agentic-commands");
        expect(sendCalls[0].messages[0].key).toBe("agent-kfk");
        const parsedCmd = JSON.parse(sendCalls[0].messages[0].value);
        expect(parsedCmd.event).toBe("user:message");
        expect(parsedCmd.payload.content).toBe("Kafka Command");

        // 2. Telemetry event -> sends to telemetryTopic
        await comm.emit("agent:message", {
            agentId: "agent-kfk",
            content: "Kafka Telemetry",
        });

        expect(sendCalls).toHaveLength(2);
        expect(sendCalls[1].topic).toBe("agentic-telemetry");
        const parsedTelem = JSON.parse(sendCalls[1].messages[0].value);
        expect(parsedTelem.event).toBe("agent:message");
        expect(parsedTelem.payload.content).toBe("Kafka Telemetry");

        // 3. Forced queue override
        await comm.emit(
            "agent:message",
            { agentId: "agent-kfk", content: "Override" },
            { delivery: "queue", partitionKey: "custom-key" },
        );
        expect(sendCalls).toHaveLength(3);
        expect(sendCalls[2].topic).toBe("agentic-commands");
        expect(sendCalls[2].messages[0].key).toBe("custom-key");
    });

    it("registers and unsubscribes handlers correctly in queue and broadcast maps", () => {
        const comm = new KafkaAgentCommunicator();

        let queueCalls = 0;
        let broadcastCalls = 0;

        const unsubQueue = comm.on("user:message", () => {
            queueCalls++;
        });

        const queueMap = (comm as any).queueHandlers;
        expect(queueMap.get("user:message")?.size).toBe(1);

        const unsubBroadcast = comm.on("agent:message", () => {
            broadcastCalls++;
        });

        const broadcastMap = (comm as any).broadcastHandlers;
        expect(broadcastMap.get("agent:message")?.size).toBe(1);

        unsubQueue();
        expect(queueMap.get("user:message")?.size).toBe(0);

        unsubBroadcast();
        expect(broadcastMap.get("agent:message")?.size).toBe(0);
    });

    it("cleans up resources upon destroy", async () => {
        const comm = new KafkaAgentCommunicator();

        let producerDisconnected = false;
        let telemetryDisconnected = false;
        let workerDisconnected = false;

        (comm as any).producer = {
            disconnect: async () => {
                producerDisconnected = true;
            },
        };
        (comm as any).telemetryConsumer = {
            disconnect: async () => {
                telemetryDisconnected = true;
            },
        };
        (comm as any).workerConsumer = {
            disconnect: async () => {
                workerDisconnected = true;
            },
        };

        await comm.destroy();

        expect(producerDisconnected).toBe(true);
        expect(telemetryDisconnected).toBe(true);
        expect(workerDisconnected).toBe(true);
        expect((comm as any).producer).toBeNull();
        expect((comm as any).telemetryConsumer).toBeNull();
        expect((comm as any).workerConsumer).toBeNull();
    });
});
