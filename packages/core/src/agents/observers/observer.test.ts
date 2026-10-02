import { describe, expect, it } from "bun:test";
import {
    type AgentConfiguration,
    AgentManager,
    type AgentObserver,
    InMemoryUserTokenManager,
} from "@/agents";
import type { AgentEventMap } from "@/agents/agent.messaging";
import type { Model } from "@/models/models";
import { z } from "zod";
import { type Tool, type ToolProvider, createTool } from "@/tools/tools";
import { InMemoryAgentCommunicator } from "../communication";
import { InMemoryAgentMemoryManager } from "../memory";
import { ConsoleAgentObserver } from "./console";
import { LoggingAgentObserver } from "./logging";

/**
 * Helper that returns a promise which resolves when the given event
 * is emitted on the communicator.
 */
function waitForEvent<K extends keyof AgentEventMap>(
    communicator: InMemoryAgentCommunicator,
    event: K,
    timeoutMs = 5000,
): Promise<AgentEventMap[K]> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error(`Timed out waiting for '${event}' event`)),
            timeoutMs,
        );
        const unsub = communicator.on(event, (payload) => {
            clearTimeout(timer);
            unsub();
            resolve(payload);
        });
    });
}

describe("AgentObserver", () => {
    it("LoggingAgentObserver outputs structured logs without throwing", () => {
        const observer = new LoggingAgentObserver();
        const dummyAgentId = "test-agent";

        expect(() => {
            observer.onTurnStart?.(dummyAgentId, "Hello agent");
            observer.onModelStart?.(dummyAgentId, "System prompt");
            observer.onModelEnd?.(dummyAgentId, []);
            observer.onAgentMessage?.(dummyAgentId, "Hello user");
            observer.onToolCallStart?.(dummyAgentId, "call_1", "get_weather", { city: "Boston" });
            observer.onToolCallEnd?.(dummyAgentId, "call_1", "get_weather", { temp: 72 });
            observer.onToolCallEnd?.(dummyAgentId, "call_2", "get_weather", null, new Error("Fail"));
            observer.onError?.(dummyAgentId, new Error("Global error"), "test");
            observer.onTurnEnd?.(dummyAgentId);
        }).not.toThrow();
    });

    it("ConsoleAgentObserver logs agent messages, tool call starts, and tool responses without throwing", () => {
        const observer = new ConsoleAgentObserver();
        const dummyAgentId = "test-agent";

        expect(() => {
            observer.onAgentMessage?.(dummyAgentId, "Hello there");
            observer.onToolCallStart?.(dummyAgentId, "call_1", "get_weather", {
                city: "Boston",
            });
            observer.onToolCallEnd?.(dummyAgentId, "call_1", "get_weather", {
                temp: 72,
            });
            observer.onToolCallEnd?.(
                dummyAgentId,
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
            onTurnStart(_agentId, message) {
                events.push(`turn_start:${message}`);
            },
            onModelStart() {
                events.push("model_start");
            },
            onModelEnd() {
                events.push("model_end");
            },
            onAgentMessage(_agentId, content) {
                events.push(`agent_message:${content}`);
            },
            onToolCallStart(_agentId, id, tool) {
                events.push(`tool_call_start:${tool}:${id}`);
            },
            onToolCallEnd(_agentId, id, tool) {
                events.push(`tool_call_end:${tool}:${id}`);
            },
            onTurnEnd() {
                events.push("turn_end");
            },
        };

        const dummyTool = createTool({
            name: "echo_tool",
            description: "Echoes input",
            inputSchema: z.object({
                text: z.string().describe("text"),
            }),
            async execute(args) {
                return { echo: args.text };
            },
        });

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
            name: "test",
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
        const tokenManager = new InMemoryUserTokenManager();

        const config: AgentConfiguration = {
            name: "TestAgent",
            description: "Test description",
            model,
            skillRepository: [],
            toolProviders: [dummyProvider],
            memoryManager,
            communicator,
            observers: [testObserver],
            userTokenManager: tokenManager
        };

        const manager = new AgentManager(config);
        await manager.init();

        const agent = await manager.createAgent("user-1");
        const completionPromise = waitForEvent(communicator, "agent:complete");

        await communicator.emit("user:message", {
            agentId: agent.id,
            content: "Run test tool",
        });

        await completionPromise;

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
            onError(_agentId, error, context) {
                errorEvents.push(
                    `error:${context}:${(error as Error).message}`,
                );
            },
            onTurnEnd(_agentId, error) {
                errorEvents.push(`turn_end:${(error as Error).message}`);
            },
        };

        const failingModel: Model = {
            name: "test",
            async execute() {
                throw new Error("Model API failure");
            },
        };

        const communicator = new InMemoryAgentCommunicator();
        const memoryManager = new InMemoryAgentMemoryManager();
        const tokenManager = new InMemoryUserTokenManager();

        const config: AgentConfiguration = {
            name: "TestAgent",
            description: "Test description",
            model: failingModel,
            skillRepository: [],
            toolProviders: [],
            memoryManager,
            communicator,
            observers: [testObserver],
            userTokenManager: tokenManager
        };

        const manager = new AgentManager(config);
        await manager.init();
        const agent = await manager.createAgent("user-1");

        let completed = false;
        communicator.on("agent:complete", () => {
            completed = true;
        });

        const completionPromise = waitForEvent(communicator, "agent:complete");

        await communicator.emit("user:message", {
            agentId: agent.id,
            content: "Trigger error",
        });

        await completionPromise;

        expect(errorEvents).toEqual([
            "turn_end:Model API failure",
            "error:model:execute:Model API failure",
            "error:agent:run:Model API failure",
        ]);
        expect(completed).toBe(true);

        manager.destroy();
    });
});
