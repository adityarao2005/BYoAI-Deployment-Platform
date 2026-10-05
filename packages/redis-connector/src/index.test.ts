import { describe, expect, it, mock } from "bun:test";
import { RedisAgentCommunicator } from "./index";

describe("RedisAgentCommunicator Unit Tests", () => {
    it("initializes with default options", () => {
        const comm = new RedisAgentCommunicator();
        expect(comm.telemetryTopic).toBe("agentic:telemetry");
        expect(comm.commandsStream).toBe("agentic:commands");
        expect(comm.consumerGroup).toBe("agentic:workers");
        expect(comm.consumerName).toMatch(/^worker-/);
    });

    it("parses custom configuration properties", () => {
        const comm = new RedisAgentCommunicator({
            TELEMETRY_TOPIC: "custom:telemetry",
            COMMANDS_STREAM: "custom:commands",
            CONSUMER_GROUP: "my-workers",
            CONSUMER_NAME: "test-worker-1",
        });
        expect(comm.telemetryTopic).toBe("custom:telemetry");
        expect(comm.commandsStream).toBe("custom:commands");
        expect(comm.consumerGroup).toBe("my-workers");
        expect(comm.consumerName).toBe("test-worker-1");
    });

    it("routes emission to queue for command events and broadcast for telemetry", async () => {
        const comm = new RedisAgentCommunicator();
        const publisher = (comm as any).publisher;

        const xaddCalls: any[] = [];
        const publishCalls: any[] = [];

        publisher.xadd = mock(async (...args: any[]) => {
            xaddCalls.push(args);
            return "12345-0";
        });
        publisher.publish = mock(async (...args: any[]) => {
            publishCalls.push(args);
            return 1;
        });

        // 1. Command event (default -> queue)
        await comm.emit("user:message", {
            agentId: "agent-1",
            content: "Hello",
        });

        expect(xaddCalls).toHaveLength(1);
        expect(xaddCalls[0][0]).toBe("agentic:commands");
        expect(xaddCalls[0][2]).toBe("event");
        expect(xaddCalls[0][3]).toBe("user:message");

        // 2. Telemetry event (default -> broadcast)
        await comm.emit("agent:message", {
            agentId: "agent-1",
            content: "Response",
        });

        expect(publishCalls).toHaveLength(1);
        expect(publishCalls[0][0]).toBe("agentic:telemetry");
        const payload = JSON.parse(publishCalls[0][1]);
        expect(payload.event).toBe("agent:message");
        expect(payload.payload.content).toBe("Response");

        // 3. Override option: emit telemetry event with delivery: queue
        await comm.emit(
            "agent:message",
            { agentId: "agent-1", content: "Forced Queue" },
            { delivery: "queue" },
        );
        expect(xaddCalls).toHaveLength(2);
        expect(xaddCalls[1][3]).toBe("agent:message");
    });

    it("registers and unsubscribes handlers correctly in queue and broadcast maps", () => {
        const comm = new RedisAgentCommunicator();

        let queueCalls = 0;
        let broadcastCalls = 0;

        // Command event -> registers in queueHandlers
        const unsubQueue = comm.on("user:message", () => {
            queueCalls++;
        });

        const queueMap = (comm as any).queueHandlers;
        expect(queueMap.get("user:message")?.size).toBe(1);

        // Telemetry event -> registers in broadcastHandlers
        const unsubBroadcast = comm.on("agent:message", () => {
            broadcastCalls++;
        });

        const broadcastMap = (comm as any).broadcastHandlers;
        expect(broadcastMap.get("agent:message")?.size).toBe(1);

        // Unsubscribe
        unsubQueue();
        expect(queueMap.get("user:message")?.size).toBe(0);

        unsubBroadcast();
        expect(broadcastMap.get("agent:message")?.size).toBe(0);
    });

    it("cleans up resources upon destroy", async () => {
        const comm = new RedisAgentCommunicator();
        const publisher = (comm as any).publisher;
        const subscriber = (comm as any).subscriber;
        const workerClient = (comm as any).workerClient;

        let publisherDisconnected = false;
        let subscriberDisconnected = false;
        let workerDisconnected = false;

        publisher.disconnect = () => {
            publisherDisconnected = true;
        };
        subscriber.disconnect = () => {
            subscriberDisconnected = true;
        };
        subscriber.unsubscribe = async () => {};
        workerClient.disconnect = () => {
            workerDisconnected = true;
        };

        await comm.destroy();

        expect(publisherDisconnected).toBe(true);
        expect(subscriberDisconnected).toBe(true);
        expect(workerDisconnected).toBe(true);
        expect((comm as any).isDestroyed).toBe(true);
    });
});
