import { describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Model } from "@/models/models";
import type { Tool, ToolProvider } from "@/tools/tools";
import { constructSystemPrompt, type AgentConfiguration, AgentManager, AgentMemory } from "./agents";
import type { Skill } from "../skills";
import { InMemoryAgentCommunicator } from "./communication";
import {
    InMemoryAgentMemoryManager,
    JsonFileAgentMemoryManager,
} from "./memory";

describe("AgentMemory", () => {
    it("correctly computes pending tool calls and handles resolution", () => {
        const memory = new AgentMemory("test", "user-1");

        expect(memory.getPendingToolCalls()).toEqual([]);

        memory.transcript.push({
            type: "tool_call",
            id: "call_1",
            tool: {
                name: "test",
                description: "",
                inputSchema: {
                    type: "object",
                    description: "",
                    properties: {},
                },
                execute: async () => {},
            },
            arguments: {},
        });
        memory.transcript.push({
            type: "tool_call",
            id: "call_2",
            tool: {
                name: "test",
                description: "",
                inputSchema: {
                    type: "object",
                    description: "",
                    properties: {},
                },
                execute: async () => {},
            },
            arguments: {},
        });

        expect(memory.getPendingToolCalls()).toEqual(["call_1", "call_2"]);

        // Resolve call_1
        memory.transcript.push({
            type: "tool_response",
            id: "call_1",
            tool: {
                name: "test",
                description: "",
                inputSchema: {
                    type: "object",
                    description: "",
                    properties: {},
                },
                execute: async () => {},
            },
            result: "ok",
        });

        expect(memory.getPendingToolCalls()).toEqual(["call_2"]);

        // Non-existent tool response should not delete other elements (avoids splice(-1, 1) bug)
        memory.transcript.push({
            type: "tool_response",
            id: "unknown_id",
            tool: {
                name: "test",
                description: "",
                inputSchema: {
                    type: "object",
                    description: "",
                    properties: {},
                },
                execute: async () => {},
            },
            result: "ok",
        });

        expect(memory.getPendingToolCalls()).toEqual(["call_2"]);

        // Resolve call_2
        memory.transcript.push({
            type: "tool_response",
            id: "call_2",
            tool: {
                name: "test",
                description: "",
                inputSchema: {
                    type: "object",
                    description: "",
                    properties: {},
                },
                execute: async () => {},
            },
            result: "ok",
        });

        expect(memory.getPendingToolCalls()).toEqual([]);
    });
});

describe("constructSystemPrompt", () => {
    it("renders basic system prompt without skillsPath", () => {
        const prompt = constructSystemPrompt("Bot", "Helper bot", []);
        expect(prompt).toContain("AI Agent named Bot");
        expect(prompt).not.toContain("Skills Directory:");
    });

    it("renders skills directory and skill location tags when skillsPath is present", () => {
        const skills: Skill[] = [
            {
                frontMatter: {
                    name: "calculator",
                    description: "Performs math calculations",
                },
                body: "calc body",
            },
        ];

        const prompt = constructSystemPrompt(
            "Bot",
            "Helper bot",
            skills,
            "/workspace/agent-123/skills",
        );

        expect(prompt).toContain("## Skills Directory:");
        expect(prompt).toContain("/workspace/agent-123/skills");
        expect(prompt).toContain("<location>/workspace/agent-123/skills/calculator</location>");
    });
});

describe("AgentManager Integration", () => {
    it("creates an agent and handles basic message turn via communicator events", async () => {
        const communicator = new InMemoryAgentCommunicator();
        const memoryManager = new InMemoryAgentMemoryManager();

        const model: Model = {
            name: "test",
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

        const agent = await manager.createAgent("user-1");
        expect(agent.id).toBeDefined();

        await communicator.emit("user:message", {
            agentId: agent.id,
            content: "Hi there",
        });

        // Verify events emitted
        const eventNames = communicator.emitted.map((e) => e.event);
        expect(eventNames).toContain("user:message");
        expect(eventNames).toContain("agent:run");
        expect(eventNames).toContain("agent:message");
        expect(eventNames).toContain("agent:complete");

        const agentMessageEvent = communicator.emitted.find(
            (e) => e.event === "agent:message",
        );
        expect(agentMessageEvent?.payload.content).toBe(
            "Hello! How can I assist you?",
        );

        // Verify transcript
        const memory = await memoryManager.getAgentMemory(agent.id);
        expect(memory.transcript).toHaveLength(2);
        expect(memory.transcript[0]).toMatchObject({
            role: "user",
            content: "Hi there",
        });
        expect(memory.transcript[1]).toMatchObject({
            role: "assistant",
            content: "Hello! How can I assist you?",
        });

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
            name: "test",
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

        const agent = await manager.createAgent("user-1");
        await communicator.emit("user:message", {
            agentId: agent.id,
            content: "What is 5 + 7?",
        });

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

        const memory = await memoryManager.getAgentMemory(agent.id);
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
            name: "test",
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
                        content:
                            "I encountered an error trying to run the tool.",
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

        const agent = await manager.createAgent("user-1");
        await communicator.emit("user:message", {
            agentId: agent.id,
            content: "Run the failing tool",
        });

        const toolCompleteEvent = communicator.emitted.find(
            (e) => e.event === "tool:complete",
        );
        expect(toolCompleteEvent?.payload.result).toEqual({
            error: "Simulated network timeout",
        });

        const agentCompleteEvent = communicator.emitted.find(
            (e) => e.event === "agent:complete",
        );
        expect(agentCompleteEvent).toBeDefined();

        manager.destroy();
    });
});

describe("JsonFileAgentMemoryManager", () => {
    it("persists memory records to JSON files and retrieves them across instances", async () => {
        const tempDir = await fs.mkdtemp(
            path.join(os.tmpdir(), "agent-memory-test-"),
        );

        try {
            const memoryManager1 = new JsonFileAgentMemoryManager(tempDir);
            const agentId = await memoryManager1.createAgentMemoryEntry("test", "user-1");

            await memoryManager1.setComputerId(agentId, "comp-999");
            await memoryManager1.addTranscriptEntries(agentId, [
                {
                    role: "user",
                    type: "message",
                    content: "Hello persistent memory!",
                },
            ]);

            // Create a new memory manager instance pointing to the same directory
            const memoryManager2 = new JsonFileAgentMemoryManager(tempDir);
            const retrievedMemory =
                await memoryManager2.getAgentMemory(agentId);

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

    it("retrieves single agent and all agents from disk", async () => {
        const tempDir = await fs.mkdtemp(
            path.join(os.tmpdir(), "agent-memory-test-"),
        );

        try {
            const memoryManager = new JsonFileAgentMemoryManager(tempDir);
            const id1 = await memoryManager.createAgentMemoryEntry("agent1", "user-1");
            const id2 = await memoryManager.createAgentMemoryEntry("agent2", "user-1");

            const agent1 = await memoryManager.getAgent(id1);
            expect(agent1).toEqual({
                id: id1,
                name: "agent1",
                userId: "user-1",
                computerId: undefined,
            });

            const nonExistent = await memoryManager.getAgent("non-existent");
            expect(nonExistent).toBeUndefined();

            const allAgents = await memoryManager.getAllAgents();
            expect(allAgents).toHaveLength(2);
            expect(allAgents).toContain(id1);
            expect(allAgents).toContain(id2);
        } finally {
            await fs.rm(tempDir, { recursive: true, force: true });
        }
    });

    it("scopes agents by user correctly on JsonFileAgentMemoryManager", async () => {
        const tempDir = await fs.mkdtemp(
            path.join(os.tmpdir(), "agent-memory-user-test-"),
        );

        try {
            const memoryManager = new JsonFileAgentMemoryManager(tempDir);
            const id1 = await memoryManager.createAgentMemoryEntry("agent-user1", "user-1");
            const id2 = await memoryManager.createAgentMemoryEntry("agent-user2", "user-2");

            const agent1Owned = await memoryManager.getAgentByUser(id1, "user-1");
            expect(agent1Owned).toBeDefined();
            expect(agent1Owned?.userId).toBe("user-1");

            const agent1NotOwned = await memoryManager.getAgentByUser(id1, "user-2");
            expect(agent1NotOwned).toBeUndefined();

            const user1Agents = await memoryManager.getAllAgentsByUser("user-1");
            expect(user1Agents).toEqual([id1]);

            const user2Agents = await memoryManager.getAllAgentsByUser("user-2");
            expect(user2Agents).toEqual([id2]);
        } finally {
            await fs.rm(tempDir, { recursive: true, force: true });
        }
    });
});

describe("InMemoryAgentMemoryManager & AgentManager User Scoping", () => {
    it("scopes agents by user correctly on InMemoryAgentMemoryManager", async () => {
        const memoryManager = new InMemoryAgentMemoryManager();
        const id1 = await memoryManager.createAgentMemoryEntry("agent-1", "user-1");
        const id2 = await memoryManager.createAgentMemoryEntry("agent-2", "user-2");

        const agent1Owned = await memoryManager.getAgentByUser(id1, "user-1");
        expect(agent1Owned).toBeDefined();
        expect(agent1Owned?.userId).toBe("user-1");

        const agent1NotOwned = await memoryManager.getAgentByUser(id1, "user-2");
        expect(agent1NotOwned).toBeUndefined();

        const user1Agents = await memoryManager.getAllAgentsByUser("user-1");
        expect(user1Agents).toEqual([id1]);

        const user2Agents = await memoryManager.getAllAgentsByUser("user-2");
        expect(user2Agents).toEqual([id2]);
    });

    it("AgentManager handles user-scoped interaction methods", async () => {
        const communicator = new InMemoryAgentCommunicator();
        const memoryManager = new InMemoryAgentMemoryManager();

        const model: Model = {
            name: "test",
            async execute() {
                return [{ role: "assistant", type: "message", content: "ok" }];
            },
        };

        const config: AgentConfiguration = {
            name: "UserScopeAgent",
            description: "Test",
            model,
            skillRepository: [],
            toolProviders: [],
            memoryManager,
            communicator,
        };

        const manager = new AgentManager(config);
        await manager.init();

        const agentU1 = await manager.createAgent("user-1");
        const agentU2 = await manager.createAgent("user-2");

        // getAgentInteractionByUser for correct user
        const interactionU1 = await manager.getAgentInteractionByUser(agentU1.id, "user-1");
        expect(interactionU1).toBeDefined();
        expect(interactionU1?.userId).toBe("user-1");

        // getAgentInteractionByUser for incorrect user
        const interactionForbidden = await manager.getAgentInteractionByUser(agentU1.id, "user-2");
        expect(interactionForbidden).toBeUndefined();

        // getAllAgentsByUser
        const allU1 = await manager.getAllAgentsByUser("user-1");
        expect(allU1).toEqual([agentU1.id]);

        const allU2 = await manager.getAllAgentsByUser("user-2");
        expect(allU2).toEqual([agentU2.id]);

        manager.destroy();
    });
});

