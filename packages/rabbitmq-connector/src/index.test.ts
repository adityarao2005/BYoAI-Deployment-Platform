import { describe, expect, it, mock } from "bun:test";
import { RabbitMQAgentCommunicator } from "./index";

describe("RabbitMQAgentCommunicator Unit Tests", () => {
    it("initializes with default options", () => {
        const comm = new RabbitMQAgentCommunicator();
        expect(comm.telemetryExchange).toBe("agentic:telemetry");
        expect(comm.commandsQueue).toBe("agentic:commands");
        expect(comm.prefetch).toBe(1);
        expect(comm.connectionUrl).toContain("127.0.0.1:5672");
    });

    it("parses custom configuration properties", () => {
        const comm = new RabbitMQAgentCommunicator({
            url: "amqp://user:secret@mybroker:5672/vhost",
            TELEMETRY_EXCHANGE: "custom.telemetry",
            COMMANDS_QUEUE: "custom.commands",
            prefetch: 10,
        });
        expect(comm.connectionUrl).toBe("amqp://user:secret@mybroker:5672/vhost");
        expect(comm.telemetryExchange).toBe("custom.telemetry");
        expect(comm.commandsQueue).toBe("custom.commands");
        expect(comm.prefetch).toBe(10);
    });

    it("routes emission to queue for command events and exchange for telemetry", async () => {
        const comm = new RabbitMQAgentCommunicator();

        const sendToQueueCalls: any[] = [];
        const publishCalls: any[] = [];

        (comm as any).channel = {
            sendToQueue: mock((queue: string, buffer: Buffer, options: any) => {
                sendToQueueCalls.push({ queue, buffer, options });
                return true;
            }),
            publish: mock((exchange: string, routingKey: string, buffer: Buffer) => {
                publishCalls.push({ exchange, routingKey, buffer });
                return true;
            }),
        };

        // 1. Command event -> sendToQueue
        await comm.emit("user:message", {
            agentId: "agent-1",
            content: "Hello RabbitMQ",
        });

        expect(sendToQueueCalls).toHaveLength(1);
        expect(sendToQueueCalls[0].queue).toBe("agentic:commands");
        const cmdPayload = JSON.parse(
            sendToQueueCalls[0].buffer.toString("utf8"),
        );
        expect(cmdPayload.event).toBe("user:message");
        expect(cmdPayload.payload.content).toBe("Hello RabbitMQ");

        // 2. Telemetry event -> publish to fanout exchange
        await comm.emit("agent:message", {
            agentId: "agent-1",
            content: "Telemetry Stream",
        });

        expect(publishCalls).toHaveLength(1);
        expect(publishCalls[0].exchange).toBe("agentic:telemetry");
        const telemPayload = JSON.parse(
            publishCalls[0].buffer.toString("utf8"),
        );
        expect(telemPayload.event).toBe("agent:message");
        expect(telemPayload.payload.content).toBe("Telemetry Stream");

        // 3. Forced queue override
        await comm.emit(
            "agent:message",
            { agentId: "agent-1", content: "Forced Queue" },
            { delivery: "queue" },
        );
        expect(sendToQueueCalls).toHaveLength(2);
    });

    it("registers and unsubscribes handlers correctly in queue and broadcast maps", () => {
        const comm = new RabbitMQAgentCommunicator();

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
        const comm = new RabbitMQAgentCommunicator();

        let channelClosed = false;
        let connectionClosed = false;

        (comm as any).channel = {
            close: async () => {
                channelClosed = true;
            },
        };
        (comm as any).connection = {
            close: async () => {
                connectionClosed = true;
            },
        };

        await comm.destroy();

        expect(channelClosed).toBe(true);
        expect(connectionClosed).toBe(true);
        expect((comm as any).channel).toBeNull();
        expect((comm as any).connection).toBeNull();
    });
});
