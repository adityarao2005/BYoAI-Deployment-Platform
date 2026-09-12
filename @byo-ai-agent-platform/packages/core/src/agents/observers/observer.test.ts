import { describe, expect, it } from "bun:test";
import type { Model } from "@/models/models";
import type { Tool, ToolProvider } from "@/tools/tools";
import {
    type AgentConfiguration,
    AgentManager,
    type AgentObserver,
} from "../agents";
import { InMemoryAgentCommunicator } from "../communication";
import { InMemoryAgentMemoryManager } from "../memory";
import { ConsoleAgentObserver } from "./console";

describe("AgentObserver", () => {
    it("ConsoleAgentObserver logs agent messages, tool call starts, and tool responses without throwing", () => {
        const observer = new ConsoleAgentObserver();
        const dummyAgent = { id: "test-agent" };

        expect(() => {
            observer.onAgentMessage?.(dummyAgent, "Hello there");
            observer.onToolCallStart?.(dummyAgent, "call_1", "get_weather", {
                city: "Boston",
            });
            observer.onToolCallEnd?.(dummyAgent, "call_1", "get_weather", {
                temp: 72,
            });
            observer.onToolCallEnd?.(
                dummyAgent,
                "call_2",
                "get_weather",
                { error: "Network error" },
                new Error("Network error"),
            );
        }).not.toThrow();
    });

    it("AgentManager invokes observer lifecycle methods in strict chronological order", async () => {
        const events: string[] = [];

        const testObserver: AgentObserver = {
            onTurnStart(_agent, message) {
                events.push(`turn_start:${message}`);
            },
            onModelStart() {
                events.push("model_start");
            },
            onModelEnd() {
                events.push("model_end");
            },
            onAgentMessage(_agent, content) {
                events.push(`agent_message:${content}`);
            },
            onToolCallStart(_agent, id, tool) {
                events.push(`tool_call_start:${tool}:${id}`);
            },
            onToolCallEnd(_agent, id, tool) {
                events.push(`tool_call_end:${tool}:${id}`);
            },
            onTurnEnd() {
                events.push("turn_end");
            },
        };

        const dummyTool: Tool = {
            name: "echo_tool",
            description: "Echoes input",
            inputSchema: {
                type: "object",
                description: "params",
                properties: {
                    text: { type: "string", description: "text" },
                },
                required: ["text"],
            },
            async execute(args) {
                return { echo: args.text };
            },
        };

        const dummyProvider: ToolProvider = {
            async getAllTools() {
                return [dummyTool];
            },
            async getToolByName(name) {
                return name === dummyTool.name ? dummyTool : null;
            },
        };

        let modelTurn = 0;
        const model: Model = {
            async execute() {
                modelTurn++;
                if (modelTurn === 1) {
                    return [
                        {
                            type: "tool_call",
                            id: "call_abc",
                            tool: dummyTool,
                            arguments: { text: "hello world" },
                        },
                    ];
                }
                return [
                    {
                        role: "assistant",
                        type: "message",
                        content: "Tool completed successfully.",
                    },
                ];
            },
        };

        const communicator = new InMemoryAgentCommunicator();
        const memoryManager = new InMemoryAgentMemoryManager();

        const config: AgentConfiguration = {
            name: "TestAgent",
            description: "Test description",
            model,
            skillRepository: [],
            toolProviders: [dummyProvider],
            memoryManager,
            communicator,
            observers: [testObserver],
        };

        const manager = new AgentManager(config);
        await manager.init();

        const agent = await manager.createAgent();

        await communicator.emit("user:message", {
            agent,
            content: "Run test tool",
        });

        expect(events).toEqual([
            "turn_start:Run test tool",
            "model_start",
            "model_end",
            "tool_call_start:echo_tool:call_abc",
            "tool_call_end:echo_tool:call_abc",
            "model_start",
            "model_end",
            "agent_message:Tool completed successfully.",
            "turn_end",
        ]);

        manager.destroy();
    });

    it("AgentManager notifies onError and onTurnEnd when model execution fails", async () => {
        const errorEvents: string[] = [];

        const testObserver: AgentObserver = {
            onError(_agent, error, context) {
                errorEvents.push(`error:${context}:${(error as Error).message}`);
            },
            onTurnEnd(_agent, error) {
                errorEvents.push(`turn_end:${(error as Error).message}`);
            },
        };

        const failingModel: Model = {
            async execute() {
                throw new Error("Model API failure");
            },
        };

        const communicator = new InMemoryAgentCommunicator();
        const memoryManager = new InMemoryAgentMemoryManager();

        const config: AgentConfiguration = {
            name: "TestAgent",
            description: "Test description",
            model: failingModel,
            skillRepository: [],
            toolProviders: [],
            memoryManager,
            communicator,
            observers: [testObserver],
        };

        const manager = new AgentManager(config);
        await manager.init();
        const agent = await manager.createAgent();

        let completed = false;
        communicator.on("agent:complete", () => {
            completed = true;
        });

        await communicator.emit("user:message", {
            agent,
            content: "Trigger error",
        });

        expect(errorEvents).toEqual([
            "turn_end:Model API failure",
            "error:model:execute:Model API failure",
            "error:agent:run:Model API failure",
        ]);
        expect(completed).toBe(true);

        manager.destroy();
    });
});

