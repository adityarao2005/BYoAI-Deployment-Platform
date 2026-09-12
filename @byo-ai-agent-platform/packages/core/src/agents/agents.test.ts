import { describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { Model } from "@/models/models";
import {
    AgentMemory,
    AgentManager,
    type Agent,
    type AgentConfiguration,
} from "./agents";
import { InMemoryAgentCommunicator } from "./communication";
import { InMemoryAgentMemoryManager, JsonFileAgentMemoryManager } from "./memory";
import type { ModelInteraction, ModelMessageOutput } from "@/models/conversation";
import type { Tool, ToolProvider } from "@/tools/tools";

describe("AgentMemory", () => {
    it("correctly computes pending tool calls and handles resolution", () => {
        const memory = new AgentMemory();

        expect(memory.getPendingToolCalls()).toEqual([]);

        memory.transcript.push({
            type: "tool_call",
            id: "call_1",
            tool: { name: "test", description: "", inputSchema: { type: "object", description: "", properties: {} }, execute: async () => {} },
            arguments: {},
        });
        memory.transcript.push({
            type: "tool_call",
            id: "call_2",
            tool: { name: "test", description: "", inputSchema: { type: "object", description: "", properties: {} }, execute: async () => {} },
            arguments: {},
        });

        expect(memory.getPendingToolCalls()).toEqual(["call_1", "call_2"]);

        // Resolve call_1
        memory.transcript.push({
            type: "tool_response",
            id: "call_1",
            tool: { name: "test", description: "", inputSchema: { type: "object", description: "", properties: {} }, execute: async () => {} },
            result: "ok",
        });

        expect(memory.getPendingToolCalls()).toEqual(["call_2"]);

        // Non-existent tool response should not delete other elements (avoids splice(-1, 1) bug)
        memory.transcript.push({
            type: "tool_response",
            id: "unknown_id",
            tool: { name: "test", description: "", inputSchema: { type: "object", description: "", properties: {} }, execute: async () => {} },
            result: "ok",
        });

        expect(memory.getPendingToolCalls()).toEqual(["call_2"]);

        // Resolve call_2
        memory.transcript.push({
            type: "tool_response",
            id: "call_2",
            tool: { name: "test", description: "", inputSchema: { type: "object", description: "", properties: {} }, execute: async () => {} },
            result: "ok",
        });

        expect(memory.getPendingToolCalls()).toEqual([]);
    });
});

describe("AgentManager Integration", () => {
    it("creates an agent and handles basic message turn via communicator events", async () => {
        const communicator = new InMemoryAgentCommunicator();
        const memoryManager = new InMemoryAgentMemoryManager();

        const model: Model = {
            async execute(_input) {
                return [
                    {
                        role: "assistant",
                        type: "message",
                        content: "Hello! How can I assist you?",
                    },
                ];
            },
        };

        const config: AgentConfiguration = {
            name: "Assistant",
            description: "A helpful assistant",
            model,
            skillRepository: [],
            toolProviders: [],
            memoryManager,
            communicator,
        };

        const manager = new AgentManager(config);
        await manager.init();

        const agent = await manager.createAgent();
        expect(agent.id).toBeDefined();

        await communicator.emit("user:message", { agent, content: "Hi there" });

        // Verify events emitted
        const eventNames = communicator.emitted.map((e) => e.event);
        expect(eventNames).toContain("user:message");
        expect(eventNames).toContain("agent:run");
        expect(eventNames).toContain("agent:message");
        expect(eventNames).toContain("agent:complete");

        const agentMessageEvent = communicator.emitted.find((e) => e.event === "agent:message");
        expect(agentMessageEvent?.payload.content).toBe("Hello! How can I assist you?");

        // Verify transcript
        const memory = await memoryManager.getAgentMemory(agent);
        expect(memory.transcript).toHaveLength(2);
        expect(memory.transcript[0]).toMatchObject({ role: "user", content: "Hi there" });
        expect(memory.transcript[1]).toMatchObject({ role: "assistant", content: "Hello! How can I assist you?" });

        manager.destroy();
    });

    it("handles tool calling loop and completes when all tool calls resolve", async () => {
        const communicator = new InMemoryAgentCommunicator();
        const memoryManager = new InMemoryAgentMemoryManager();

        let toolExecuted = false;

        const calculatorTool: Tool = {
            name: "calculate",
            description: "Add numbers",
            inputSchema: {
                type: "object",
                description: "params",
                properties: {
                    a: { type: "integer", description: "First number" },
                    b: { type: "integer", description: "Second number" },
                },
                required: ["a", "b"],
            },
            async execute(args, _session) {
                toolExecuted = true;
                return { result: args.a + args.b };
            },
        };

        const toolProvider: ToolProvider = {
            async getAllTools() {
                return [calculatorTool];
            },
            async getToolByName(name) {
                return name === calculatorTool.name ? calculatorTool : null;
            },
        };

        let turns = 0;
        const model: Model = {
            async execute(_input) {
                turns++;
                if (turns === 1) {
                    return [
                        {
                            type: "tool_call",
                            id: "call_calc_1",
                            tool: calculatorTool,
                            arguments: { a: 5, b: 7 },
                        },
                    ];
                }
                return [
                    {
                        role: "assistant",
                        type: "message",
                        content: "The result is 12.",
                    },
                ];
            },
        };

        const config: AgentConfiguration = {
            name: "MathAgent",
            description: "An agent that solves math problems",
            model,
            skillRepository: [],
            toolProviders: [toolProvider],
            memoryManager,
            communicator,
        };

        const manager = new AgentManager(config);
        await manager.init();

        const agent = await manager.createAgent();
        await communicator.emit("user:message", { agent, content: "What is 5 + 7?" });

        expect(toolExecuted).toBe(true);

        const eventNames = communicator.emitted.map((e) => e.event);
        expect(eventNames).toEqual([
            "user:message",
            "agent:run",
            "tool:call",
            "tool:complete",
            "agent:run",
            "agent:message",
            "agent:complete",
        ]);

        const memory = await memoryManager.getAgentMemory(agent);
        expect(memory.transcript).toHaveLength(4);
        expect(memory.transcript[0]?.type).toBe("message");
        expect(memory.transcript[1]?.type).toBe("tool_call");
        expect(memory.transcript[2]?.type).toBe("tool_response");
        expect(memory.transcript[3]?.type).toBe("message");

        manager.destroy();
    });

    it("safely handles tool execution errors without crashing the manager", async () => {
        const communicator = new InMemoryAgentCommunicator();
        const memoryManager = new InMemoryAgentMemoryManager();

        const failingTool: Tool = {
            name: "fail_tool",
            description: "A tool that throws an error",
            inputSchema: {
                type: "object",
                description: "params",
                properties: {
                    value: { type: "string", description: "any string" },
                },
                required: ["value"],
            },
            async execute() {
                throw new Error("Simulated network timeout");
            },
        };

        const toolProvider: ToolProvider = {
            async getAllTools() {
                return [failingTool];
            },
            async getToolByName(name) {
                return name === failingTool.name ? failingTool : null;
            },
        };

        let turns = 0;
        const model: Model = {
            async execute(_input) {
                turns++;
                if (turns === 1) {
                    return [
                        {
                            type: "tool_call",
                            id: "call_fail_1",
                            tool: failingTool,
                            arguments: { value: "test" },
                        },
                    ];
                }
                return [
                    {
                        role: "assistant",
                        type: "message",
                        content: "I encountered an error trying to run the tool.",
                    },
                ];
            },
        };

        const config: AgentConfiguration = {
            name: "ErrorTester",
            description: "Testing error handling",
            model,
            skillRepository: [],
            toolProviders: [toolProvider],
            memoryManager,
            communicator,
        };

        const manager = new AgentManager(config);
        await manager.init();

        const agent = await manager.createAgent();
        await communicator.emit("user:message", { agent, content: "Run the failing tool" });

        const toolCompleteEvent = communicator.emitted.find((e) => e.event === "tool:complete");
        expect(toolCompleteEvent?.payload.result).toEqual({ error: "Simulated network timeout" });

        const agentCompleteEvent = communicator.emitted.find((e) => e.event === "agent:complete");
        expect(agentCompleteEvent).toBeDefined();

        manager.destroy();
    });
});

describe("JsonFileAgentMemoryManager", () => {
    it("persists memory records to JSON files and retrieves them across instances", async () => {
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-test-"));

        try {
            const memoryManager1 = new JsonFileAgentMemoryManager(tempDir);
            const agentId = await memoryManager1.createAgentMemoryEntry();
            const agent = { id: agentId };

            await memoryManager1.setComputerId(agent, "comp-999");
            await memoryManager1.addTranscriptEntries(agent, [
                {
                    role: "user",
                    type: "message",
                    content: "Hello persistent memory!",
                },
            ]);

            // Create a new memory manager instance pointing to the same directory
            const memoryManager2 = new JsonFileAgentMemoryManager(tempDir);
            const retrievedMemory = await memoryManager2.getAgentMemory(agent);

            expect(retrievedMemory.computerId).toBe("comp-999");
            expect(retrievedMemory.transcript).toHaveLength(1);
            expect(retrievedMemory.transcript[0]).toMatchObject({
                role: "user",
                content: "Hello persistent memory!",
            });
        } finally {
            await fs.rm(tempDir, { recursive: true, force: true });
        }
    });
});