import { describe, expect, it } from "bun:test";
import {
    type AgentConfiguration,
    type AgentSession,
    type AgentHandle,
    InMemoryAgentCommunicator,
    InMemoryAgentMemoryManager,
    InMemoryUserTokenManager,
    InMemoryComputerLifecycleManager,
    CompositeMemoryManager,
} from "@/agents";
import { AgentMemory } from "@/agents/agent.memory";
import type { Model, ModelInput, ModelMessageOutput } from "@/models";
import type { Tool, ToolProvider } from "../tools";
import { createTool } from "../tools";
import { ScratchpadToolProvider } from "../scratchpad";
import { TodosToolProvider } from "../todos";
import {
    SubAgentToolProvider,
    type SubAgentContext,
} from "./index";
import type { SubAgentToolProviderConfig } from "@/config";
import { z } from "zod";

describe("SubAgentToolProvider", () => {
    function createMockModel(
        handler: (input: ModelInput) => Promise<ModelMessageOutput[]>,
    ): Model {
        return {
            name: "mock-model",
            execute: handler,
        };
    }

    function createDummySession(
        agentId = "parent-agent-1",
        computerId?: string,
        skillRepositories: any[] = [],
    ): AgentSession {
        const handle: AgentHandle = {
            id: agentId,
            name: "parent-agent",
            userId: "user-1",
            computerId,
        };
        return {
            agent: handle,
            name: "parent-session",
            description: "Parent session description",
            userId: "user-1",
            memory: new AgentMemory("parent-agent", "user-1"),
            mode: "interactive",
            skillRepositories,
            rules: [],
            authContext: {},
            computerProvider: computerId
                ? ({
                      type: "local",
                      getComputer: async () => ({}) as any,
                  } as any)
                : undefined,
        };
    }

    function createDummyContext(
        model: Model,
        memory: CompositeMemoryManager,
        communicator: InMemoryAgentCommunicator,
        toolProviders: ToolProvider[] = [],
        skillRepository: any[] = [],
        currentDepth = 0,
    ): SubAgentContext {
        const configuration: AgentConfiguration = {
            name: "test-parent",
            description: "test parent agent",
            model,
            skillRepository,
            toolProviders,
            memoryManager: memory,
            communicator,
        };

        return {
            configuration,
            memory,
            parentCommunicator: communicator,
            parentToolProviders: toolProviders,
            currentDepth,
        };
    }

    it("should obey maxDepth and not expose create_subagent beyond limit", async () => {
        const communicator = new InMemoryAgentCommunicator();
        const memory = new CompositeMemoryManager({
            agent: new InMemoryAgentMemoryManager(),
            userToken: new InMemoryUserTokenManager(),
            computerLifecycle: new InMemoryComputerLifecycleManager(),
        });
        const config: SubAgentToolProviderConfig = {
            type: "subagent",
            allowRecursive: true,
            inheritComputer: false,
            maxDepth: 2,
            timeoutMs: 5000,
        };

        const contextAtLimit = createDummyContext(
            createMockModel(async () => []),
            memory,
            communicator,
            [],
            [],
            2,
        );

        const providerAtLimit = new SubAgentToolProvider(config, contextAtLimit);
        const tools = await providerAtLimit.getAllTools();
        expect(tools).toHaveLength(0);

        const contextBelowLimit = createDummyContext(
            createMockModel(async () => []),
            memory,
            communicator,
            [],
            [],
            1,
        );
        const providerBelow = new SubAgentToolProvider(config, contextBelowLimit);
        const availableTools = await providerBelow.getAllTools();
        expect(availableTools).toHaveLength(1);
        expect(availableTools[0]?.name).toBe("create_subagent");
    });

    it("should execute subagent successfully and emit events to parent communicator", async () => {
        const communicator = new InMemoryAgentCommunicator();
        const memory = new CompositeMemoryManager({
            agent: new InMemoryAgentMemoryManager(),
            userToken: new InMemoryUserTokenManager(),
            computerLifecycle: new InMemoryComputerLifecycleManager(),
        });

        const eventsReceived: Array<{ event: string; payload: any }> = [];
        communicator.on("subagent:start", (payload) => {
            eventsReceived.push({ event: "subagent:start", payload });
        });
        communicator.on("subagent:message", (payload) => {
            eventsReceived.push({ event: "subagent:message", payload });
        });
        communicator.on("subagent:complete", (payload) => {
            eventsReceived.push({ event: "subagent:complete", payload });
        });

        let turnCount = 0;
        const mockModel = createMockModel(async () => {
            turnCount++;
            return [
                {
                    role: "assistant",
                    type: "message",
                    content: "I have completed the task.",
                },
            ];
        });

        const subAgentConfig: SubAgentToolProviderConfig = {
            type: "subagent",
            allowRecursive: false,
            inheritComputer: false,
            maxDepth: 2,
            timeoutMs: 5000,
        };

        const context = createDummyContext(mockModel, memory, communicator);

        const provider = new SubAgentToolProvider(subAgentConfig, context);
        const subagentTool = (await provider.getToolByName("create_subagent"))!;
        expect(subagentTool).not.toBeNull();

        const session = createDummySession("parent-1");
        const result = (await subagentTool.execute(
            { goal: "Research something", context: "Here is extra context" },
            session,
        )) as { subAgentId: string; result: string };

        expect(result.result).toBe("I have completed the task.");
        expect(turnCount).toBe(1);

        // Verify events emitted on parent communicator
        const startEvent = eventsReceived.find((e) => e.event === "subagent:start");
        expect(startEvent).toBeDefined();
        expect(startEvent?.payload.agentId).toBe("parent-1");
        expect(startEvent?.payload.goal).toBe("Research something");

        const msgEvent = eventsReceived.find((e) => e.event === "subagent:message");
        expect(msgEvent).toBeDefined();
        expect(msgEvent?.payload.content).toBe("I have completed the task.");

        const completeEvent = eventsReceived.find((e) => e.event === "subagent:complete");
        expect(completeEvent).toBeDefined();
        expect(completeEvent?.payload.result).toBe("I have completed the task.");

        // Verify subagent memory entry has parentId
        const subAgentHandle = await memory.agent.getAgent(result.subAgentId);
        expect(subAgentHandle).toBeDefined();
        expect(subAgentHandle?.parentId).toBe("parent-1");

        // Verify subagent is not listed in getAllAgents but is in getSubAgents
        const topLevelAgents = await memory.agent.getAllAgents();
        expect(topLevelAgents).not.toContain(result.subAgentId);

        const subAgents = await memory.agent.getSubAgents("parent-1");
        expect(subAgents).toContain(result.subAgentId);
    });

    it("should automatically inherit skill loading tool regardless of filter", async () => {
        const communicator = new InMemoryAgentCommunicator();
        const memory = new CompositeMemoryManager({
            agent: new InMemoryAgentMemoryManager(),
            userToken: new InMemoryUserTokenManager(),
            computerLifecycle: new InMemoryComputerLifecycleManager(),
        });

        let observedTools: string[] = [];
        const mockModel = createMockModel(async (input) => {
            observedTools = (input.tools ?? []).map((t: Tool) => t.name);
            return [
                {
                    role: "assistant",
                    type: "message",
                    content: "Finished.",
                },
            ];
        });

        const dummySkillRepo = {
            name: "test-skills",
            getAllSkills: async () => [
                {
                    frontMatter: { name: "test_skill", description: "A skill" },
                    body: "skill content",
                },
            ],
            getSkillByName: async () => null,
        } as any;

        const subAgentConfig: SubAgentToolProviderConfig = {
            type: "subagent",
            // Explicitly filter to only scratchpad, NOT skills
            inheritedToolProviders: [{ name: "scratchpad" }],
            allowRecursive: false,
            inheritComputer: false,
            maxDepth: 2,
            timeoutMs: 5000,
        };

        const scratchpad = new ScratchpadToolProvider();
        const context = createDummyContext(
            mockModel,
            memory,
            communicator,
            [scratchpad],
            [dummySkillRepo],
        );

        const provider = new SubAgentToolProvider(subAgentConfig, context);
        const subagentTool = (await provider.getToolByName("create_subagent"))!;
        const session = createDummySession("parent-1", undefined, [dummySkillRepo]);

        await subagentTool.execute({ goal: "test skills" }, session);

        // Subagent should have received load_skill automatically AND scratchpad tools
        expect(observedTools).toContain("load_skill");
        expect(observedTools).toContain("get_scratchpad");
        expect(observedTools).toContain("set_scratchpad");
    });

    it("should NOT inherit computer if inheritComputer is false", async () => {
        const communicator = new InMemoryAgentCommunicator();
        const memory = new CompositeMemoryManager({
            agent: new InMemoryAgentMemoryManager(),
            userToken: new InMemoryUserTokenManager(),
            computerLifecycle: new InMemoryComputerLifecycleManager(),
        });

        let observedTools: string[] = [];
        const mockModel = createMockModel(async (input) => {
            observedTools = (input.tools ?? []).map((t: Tool) => t.name);
            return [
                {
                    role: "assistant",
                    type: "message",
                    content: "Done",
                },
            ];
        });

        const dummyComputerToolProvider: ToolProvider = {
            name: "computer",
            async getAllTools() {
                return [
                    createTool({
                        name: "computer_click",
                        description: "click",
                        inputSchema: z.object({}),
                        execute: async () => ({}),
                    }),
                ];
            },
            async getToolByName(name) {
                return name === "computer_click" ? (await this.getAllTools())[0]! : null;
            },
        };

        const subAgentConfig: SubAgentToolProviderConfig = {
            type: "subagent",
            inheritComputer: false, // Explicitly false
            allowRecursive: false,
            maxDepth: 2,
            timeoutMs: 5000,
        };

        const context = createDummyContext(
            mockModel,
            memory,
            communicator,
            [dummyComputerToolProvider],
        );

        const provider = new SubAgentToolProvider(subAgentConfig, context);
        const subagentTool = (await provider.getToolByName("create_subagent"))!;
        const session = createDummySession("parent-1", "computer-123");

        const result = (await subagentTool.execute(
            { goal: "test computer exclusion" },
            session,
        )) as { subAgentId: string; result: string };

        expect(observedTools).not.toContain("computer_click");

        // ComputerId should NOT be set on child
        const childHandle = await memory.agent.getAgent(result.subAgentId);
        expect(childHandle?.computerId).toBeUndefined();
    });

    it("should inherit computer when inheritComputer is true", async () => {
        const communicator = new InMemoryAgentCommunicator();
        const memory = new CompositeMemoryManager({
            agent: new InMemoryAgentMemoryManager(),
            userToken: new InMemoryUserTokenManager(),
            computerLifecycle: new InMemoryComputerLifecycleManager(),
        });

        let observedTools: string[] = [];
        const mockModel = createMockModel(async (input) => {
            observedTools = (input.tools ?? []).map((t: Tool) => t.name);
            return [
                {
                    role: "assistant",
                    type: "message",
                    content: "Done",
                },
            ];
        });

        const dummyComputerToolProvider: ToolProvider = {
            name: "computer",
            async getAllTools() {
                return [
                    createTool({
                        name: "computer_click",
                        description: "click",
                        inputSchema: z.object({}),
                        execute: async () => ({}),
                    }),
                ];
            },
            async getToolByName(name) {
                return name === "computer_click" ? (await this.getAllTools())[0]! : null;
            },
        };

        const subAgentConfig: SubAgentToolProviderConfig = {
            type: "subagent",
            inheritComputer: true,
            allowRecursive: false,
            maxDepth: 2,
            timeoutMs: 5000,
        };

        const context = createDummyContext(
            mockModel,
            memory,
            communicator,
            [dummyComputerToolProvider],
        );

        const provider = new SubAgentToolProvider(subAgentConfig, context);
        const subagentTool = (await provider.getToolByName("create_subagent"))!;
        const session = createDummySession("parent-1", "computer-123");

        const result = (await subagentTool.execute(
            { goal: "test computer inclusion" },
            session,
        )) as { subAgentId: string; result: string };

        expect(observedTools).toContain("computer_click");

        // ComputerId SHOULD be set on child
        const childHandle = await memory.agent.getAgent(result.subAgentId);
        expect(childHandle?.computerId).toBe("computer-123");
    });

    it("should filter tools per inheritedToolProviders rules with wildcards", async () => {
        const communicator = new InMemoryAgentCommunicator();
        const memory = new CompositeMemoryManager({
            agent: new InMemoryAgentMemoryManager(),
            userToken: new InMemoryUserTokenManager(),
            computerLifecycle: new InMemoryComputerLifecycleManager(),
        });

        let observedTools: string[] = [];
        const mockModel = createMockModel(async (input) => {
            observedTools = (input.tools ?? []).map((t: Tool) => t.name);
            return [
                {
                    role: "assistant",
                    type: "message",
                    content: "Done",
                },
            ];
        });

        const scratchpad = new ScratchpadToolProvider();
        const todos = new TodosToolProvider();

        const subAgentConfig: SubAgentToolProviderConfig = {
            type: "subagent",
            inheritedToolProviders: [
                {
                    name: "scratchpad",
                    allowedTools: ["get_*"],
                    disallowedTools: ["*set*"],
                },
                // todos is NOT in inheritedToolProviders, so it should be excluded
            ],
            allowRecursive: false,
            inheritComputer: false,
            maxDepth: 2,
            timeoutMs: 5000,
        };

        const context = createDummyContext(
            mockModel,
            memory,
            communicator,
            [scratchpad, todos],
        );

        const provider = new SubAgentToolProvider(subAgentConfig, context);
        const subagentTool = (await provider.getToolByName("create_subagent"))!;
        const session = createDummySession();

        await subagentTool.execute({ goal: "test filter" }, session);

        // get_scratchpad should be allowed, set_scratchpad disallowed, todos excluded
        expect(observedTools).toContain("get_scratchpad");
        expect(observedTools).not.toContain("set_scratchpad");
        expect(observedTools).not.toContain("get_todos");
        expect(observedTools).not.toContain("add_todo");
    });

    it("should correctly parse inheritedToolProviders in string, object, and map formats", () => {
        const { SubAgentToolProviderConfigSchema } = require("@/config");

        // Format 1: array of strings
        const parsedStrings = SubAgentToolProviderConfigSchema.parse({
            type: "subagent",
            inheritedToolProviders: ["scratchpad", "mcp"],
        });
        expect(parsedStrings.inheritedToolProviders).toEqual([
            { name: "scratchpad", allowedTools: undefined, disallowedTools: undefined },
            { name: "mcp", allowedTools: undefined, disallowedTools: undefined },
        ]);

        // Format 2: array of objects
        const parsedObjects = SubAgentToolProviderConfigSchema.parse({
            type: "subagent",
            inheritedToolProviders: [
                { name: "petstore", allowedTools: ["read*"], disallowedTools: ["write*"] },
            ],
        });
        expect(parsedObjects.inheritedToolProviders).toEqual([
            { name: "petstore", allowedTools: ["read*"], disallowedTools: ["write*"] },
        ]);

        // Format 3: map entries from YAML
        const parsedMaps = SubAgentToolProviderConfigSchema.parse({
            type: "subagent",
            inheritedToolProviders: [
                { petstore: { allowedTools: ["read*"], disallowedTools: ["write*"] } },
                "mcp",
            ],
        });
        expect(parsedMaps.inheritedToolProviders).toEqual([
            { name: "petstore", allowedTools: ["read*"], disallowedTools: ["write*"] },
            { name: "mcp", allowedTools: undefined, disallowedTools: undefined },
        ]);
    });
});
