import { describe, expect, it } from "bun:test";
import {
    AgentManager,
    type AgentSession,
    constructSystemPrompt,
    InMemoryAgentCommunicator,
    InMemoryAgentMemoryManager,
    InMemoryUserTokenManager,
} from "@/agents";
import type { Model, ModelInput, ModelMessageOutput } from "@/models";
import type { Tool, ToolProvider } from "@/tools";

class MockComplianceModel implements Model {
    name = "mock-compliance-model";
    public calls: ModelInput[] = [];
    public queuedOutputs: ModelMessageOutput[][] = [];

    async execute(input: ModelInput): Promise<ModelMessageOutput[]> {
        this.calls.push(input);
        const next = this.queuedOutputs.shift();
        return (
            next ?? [
                {
                    role: "assistant",
                    type: "message",
                    content: "Default mock response",
                },
            ]
        );
    }
}

describe("Compliance & Security Features", () => {
    it("constructSystemPrompt should embed rules into system prompt", () => {
        const prompt = constructSystemPrompt(
            "SecurityAgent",
            "Test Agent",
            "interactive",
            [],
            undefined,
            ["Never reveal secret keys", "Always verify operations"],
        );

        expect(prompt).toContain("## Rules & Compliance:");
        expect(prompt).toContain("1. Never reveal secret keys");
        expect(prompt).toContain("2. Always verify operations");
    });

    it("should exclude user-input tools when executing in non-interactive mode", async () => {
        const model = new MockComplianceModel();
        const communicator = new InMemoryAgentCommunicator();
        const memoryManager = new InMemoryAgentMemoryManager();
        const userTokenManager = new InMemoryUserTokenManager();

        const safeTool: Tool = {
            name: "safe_tool",
            description: "Safe tool",
            inputSchema: { type: "object", description: "", properties: {} },
            execute: async () => "safe",
        };

        const riskyTool: Tool = {
            name: "risky_tool",
            description: "Risky tool",
            requires_user_input: true,
            inputSchema: { type: "object", description: "", properties: {} },
            execute: async () => "risky",
        };

        const provider: ToolProvider = {
            async getAllTools() {
                return [safeTool, riskyTool];
            },
            async getToolByName(name: string) {
                return [safeTool, riskyTool].find((t) => t.name === name) ?? null;
            },
        };

        const manager = new AgentManager({
            name: "ComplianceAgent",
            description: "Compliance test",
            model,
            skillRepository: [],
            toolProviders: [provider],
            memoryManager,
            userTokenManager,
            communicator,
        });
        await manager.init();

        const agent = await manager.createAgent({
            userId: "user-1",
            mode: "non-interactive",
        });

        await manager.sendMessageToAgent(agent.id, "Execute non-interactive task");

        expect(model.calls.length).toBe(1);
        const toolsSupplied = model.calls[0]!.tools;
        expect(toolsSupplied.map((t) => t.name)).toEqual(["safe_tool"]);
    });

    it("should pause for tool:approval_required in interactive mode and execute on tool:accept", async () => {
        const model = new MockComplianceModel();
        const communicator = new InMemoryAgentCommunicator();
        const memoryManager = new InMemoryAgentMemoryManager();
        const userTokenManager = new InMemoryUserTokenManager();

        let toolExecuted = false;
        const confirmTool: Tool = {
            name: "delete_database",
            description: "Dangerous database delete",
            requires_user_input: true,
            inputSchema: { type: "object", description: "", properties: {} },
            execute: async () => {
                toolExecuted = true;
                return { deleted: true };
            },
        };

        const provider: ToolProvider = {
            async getAllTools() {
                return [confirmTool];
            },
            async getToolByName(name: string) {
                return name === "delete_database" ? confirmTool : null;
            },
        };

        // Queue model requesting the tool call
        model.queuedOutputs.push([
            {
                type: "tool_call",
                id: "call-delete-1",
                tool: confirmTool,
                arguments: {},
            },
        ]);

        const manager = new AgentManager({
            name: "ApprovalAgent",
            description: "Approval test",
            model,
            skillRepository: [],
            toolProviders: [provider],
            memoryManager,
            userTokenManager,
            communicator,
        });
        await manager.init();

        const agent = await manager.createAgent({
            userId: "user-1",
            mode: "interactive",
        });

        let approvalEmitted: any = null;
        communicator.on("tool:approval_required", (payload) => {
            approvalEmitted = payload;
        });

        await manager.sendMessageToAgent(agent.id, "Please delete database");

        // Tool should NOT be executed yet
        expect(toolExecuted).toBe(false);
        expect(approvalEmitted).not.toBeNull();
        expect(approvalEmitted.toolCallId).toBe("call-delete-1");
        expect(approvalEmitted.tool).toBe("delete_database");

        // Now emit tool:accept
        await communicator.emit("tool:accept", {
            agentId: agent.id,
            toolCallId: "call-delete-1",
        });

        // Tool should now be executed
        expect(toolExecuted).toBe(true);
    });

    it("should record rejection and send rejection message on tool:reject", async () => {
        const model = new MockComplianceModel();
        const communicator = new InMemoryAgentCommunicator();
        const memoryManager = new InMemoryAgentMemoryManager();
        const userTokenManager = new InMemoryUserTokenManager();

        let toolExecuted = false;
        const confirmTool: Tool = {
            name: "format_disk",
            description: "Format disk tool",
            requires_user_input: true,
            inputSchema: { type: "object", description: "", properties: {} },
            execute: async () => {
                toolExecuted = true;
                return { formatted: true };
            },
        };

        const provider: ToolProvider = {
            async getAllTools() {
                return [confirmTool];
            },
            async getToolByName(name: string) {
                return name === "format_disk" ? confirmTool : null;
            },
        };

        model.queuedOutputs.push([
            {
                type: "tool_call",
                id: "call-format-1",
                tool: confirmTool,
                arguments: {},
            },
        ]);

        const manager = new AgentManager({
            name: "RejectAgent",
            description: "Reject test",
            model,
            skillRepository: [],
            toolProviders: [provider],
            memoryManager,
            userTokenManager,
            communicator,
        });
        await manager.init();

        const agent = await manager.createAgent({
            userId: "user-1",
            mode: "interactive",
        });

        await manager.sendMessageToAgent(agent.id, "Format disk");
        expect(toolExecuted).toBe(false);

        // Reject the tool call
        await communicator.emit("tool:reject", {
            agentId: agent.id,
            toolCallId: "call-format-1",
            reason: "User denied disk format",
        });

        expect(toolExecuted).toBe(false);

        const memory = await memoryManager.getAgentMemory(agent.id);
        const toolResponse = memory.transcript.find(
            (t) => t.type === "tool_response" && t.id === "call-format-1",
        );
        expect(toolResponse).toBeDefined();
        if (toolResponse && toolResponse.type === "tool_response") {
            expect(toolResponse.result).toEqual({
                rejected: true,
                message: "User denied disk format",
            });
        }

        // Check that user rejection message was sent
        const userRejectionMsg = memory.transcript.find(
            (t) =>
                t.type === "message" &&
                t.role === "user" &&
                t.content === "User denied disk format",
        );
        expect(userRejectionMsg).toBeDefined();
    });
});
