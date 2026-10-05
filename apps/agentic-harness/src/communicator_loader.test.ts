import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    AgentMessagingConfigSchema,
    normalizeMessagingProperties,
} from "./agent.config";
import { createAgentCommunicator } from "./bootstrap";

describe("AgentMessagingConfigSchema & normalizeMessagingProperties", () => {
    it("defaults to in_memory when undefined", () => {
        const parsed = AgentMessagingConfigSchema.parse(undefined);
        expect(parsed).toBe("in_memory");
    });

    it("accepts literal in_memory", () => {
        const parsed = AgentMessagingConfigSchema.parse("in_memory");
        expect(parsed).toBe("in_memory");
    });

    it("accepts package with object properties", () => {
        const parsed = AgentMessagingConfigSchema.parse({
            package: "@byo-ai-agent-platform/kafka-connector",
            properties: {
                bootstrapServers: "localhost:9092",
                groupId: "agentic-harness",
            },
        });
        expect(parsed).toEqual({
            package: "@byo-ai-agent-platform/kafka-connector",
            properties: {
                bootstrapServers: "localhost:9092",
                groupId: "agentic-harness",
            },
        });
    });

    it("accepts package with array of KEY=VALUE properties", () => {
        const parsed = AgentMessagingConfigSchema.parse({
            package: "@byo-ai-agent-platform/rabbitmq-connector",
            properties: [
                "URL=amqp://guest:guest@localhost:5672",
                "EXCHANGE=agentic_events",
                "DURABLE",
            ],
        });
        expect(parsed).toEqual({
            package: "@byo-ai-agent-platform/rabbitmq-connector",
            properties: [
                "URL=amqp://guest:guest@localhost:5672",
                "EXCHANGE=agentic_events",
                "DURABLE",
            ],
        });

        const normalized = normalizeMessagingProperties(
            typeof parsed === "object" ? parsed.properties : undefined,
        );
        expect(normalized).toEqual({
            URL: "amqp://guest:guest@localhost:5672",
            EXCHANGE: "agentic_events",
            DURABLE: true,
        });
    });

    it("normalizes empty and undefined properties", () => {
        expect(normalizeMessagingProperties(undefined)).toEqual({});
        expect(normalizeMessagingProperties({})).toEqual({});
        expect(normalizeMessagingProperties([])).toEqual({});
    });
});

describe("createAgentCommunicator", () => {
    let tempDir: string | undefined;

    afterEach(async () => {
        if (tempDir) {
            await rm(tempDir, { recursive: true, force: true });
            tempDir = undefined;
        }
    });

    it("creates an InMemoryAgentCommunicator by default or when set to in_memory", async () => {
        const commDefault = await createAgentCommunicator(undefined);
        expect(commDefault).toBeDefined();
        expect(typeof commDefault.emit).toBe("function");
        expect(typeof commDefault.on).toBe("function");

        const commInMemory = await createAgentCommunicator("in_memory");
        expect(commInMemory).toBeDefined();
        expect(typeof commInMemory.emit).toBe("function");
    });

    it("dynamically loads a custom communicator module from a file path with class export", async () => {
        tempDir = await mkdtemp(join(tmpdir(), "custom-comm-test-"));
        const modulePath = join(tempDir, "custom-comm.ts");

        await writeFile(
            modulePath,
            `
export default class CustomCommunicator {
    public initialized = false;
    public props: any;

    constructor(props: any) {
        this.props = props;
    }

    async init() {
        this.initialized = true;
    }

    async emit(event: string, payload: any) {}

    on(event: string, handler: any) {
        return () => {};
    }

    async destroy() {}
}
            `,
            "utf8",
        );

        const comm = await createAgentCommunicator({
            package: modulePath,
            properties: {
                brokerUrl: "tcp://127.0.0.1:9092",
            },
        });

        expect(comm).toBeDefined();
        expect((comm as any).initialized).toBe(true);
        expect((comm as any).props).toEqual({
            brokerUrl: "tcp://127.0.0.1:9092",
        });
    });

    it("dynamically loads a custom communicator from a factory function export", async () => {
        tempDir = await mkdtemp(join(tmpdir(), "factory-comm-test-"));
        const modulePath = join(tempDir, "factory-comm.ts");

        await writeFile(
            modulePath,
            `
export function createCommunicator(props: any) {
    let inited = false;
    return {
        props,
        inited,
        async init() {
            this.inited = true;
        },
        async emit() {},
        on() {
            return () => {};
        },
    };
}
            `,
            "utf8",
        );

        const comm = await createAgentCommunicator({
            package: modulePath,
            properties: ["BROKER=localhost", "PORT=6379"],
        });

        expect(comm).toBeDefined();
        expect((comm as any).inited).toBe(true);
        expect((comm as any).props).toEqual({
            BROKER: "localhost",
            PORT: "6379",
        });
    });

    it("throws a ConfigError when an invalid package or path is provided", async () => {
        await expect(
            createAgentCommunicator({
                package: "./non-existent-connector-module-12345.ts",
            }),
        ).rejects.toThrow("Failed to load communicator package from path");
    });

    it("throws a ConfigError when package does not export a valid communicator", async () => {
        tempDir = await mkdtemp(join(tmpdir(), "invalid-comm-test-"));
        const modulePath = join(tempDir, "invalid-comm.ts");

        await writeFile(
            modulePath,
            `
export const someOtherExport = 42;
            `,
            "utf8",
        );

        await expect(
            createAgentCommunicator({
                package: modulePath,
            }),
        ).rejects.toThrow("does not export default, AgentCommunicator, or createCommunicator");
    });
});
