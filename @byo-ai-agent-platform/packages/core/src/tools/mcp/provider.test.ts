import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { Client } from "@modelcontextprotocol/client";
import type { AgentHandle, AgentSession } from "@/agents";
import { type McpClientFactory, McpServerToolProvider } from "./provider";

const vi = { fn: mock };

function createAgent(id: string, name: string): AgentHandle {
    return {
        id,
        name,
    };
}

describe("McpServerToolProvider", () => {
    let mockClientA: any;
    let mockClientB: any;
    let mockFactory: McpClientFactory;

    beforeEach(() => {
        mockClientA = {
            listTools: vi.fn().mockResolvedValue({
                tools: [
                    {
                        name: "echo",
                        description: "Echoes input back",
                        inputSchema: {
                            type: "object",
                            properties: {
                                message: {
                                    type: "string",
                                    description: "The message",
                                },
                            },
                            required: ["message"],
                        },
                    },
                    {
                        name: "no_args",
                        description: "Takes no arguments",
                        inputSchema: {
                            type: "object",
                        },
                    },
                ],
            }),
            listResources: vi.fn().mockResolvedValue({
                resources: [
                    {
                        uri: "file:///config.json",
                        name: "Config File",
                        mimeType: "application/json",
                    },
                ],
            }),
            callTool: vi.fn().mockResolvedValue({
                content: [{ type: "text", text: "echoed: hello" }],
            }),
            readResource: vi.fn().mockResolvedValue({
                contents: [
                    { uri: "file:///config.json", text: '{"key": "value"}' },
                ],
            }),
            close: vi.fn().mockResolvedValue(undefined),
        };

        mockClientB = {
            listTools: vi.fn().mockResolvedValue({
                tools: [
                    {
                        name: "agent_b_tool",
                        description: "Agent B specific tool",
                        inputSchema: { type: "object" },
                    },
                ],
            }),
            listResources: vi.fn().mockResolvedValue({ resources: [] }),
            callTool: vi.fn().mockResolvedValue({
                content: [{ type: "text", text: "from agent B" }],
            }),
            readResource: vi.fn().mockResolvedValue({ contents: [] }),
            close: vi.fn().mockResolvedValue(undefined),
        };

        mockFactory = {
            name: "test_server",
            createClient: vi.fn().mockImplementation(async (agent: AgentHandle) => {
                if (agent.id === "agent-b")
                    return mockClientB as unknown as Client;
                return mockClientA as unknown as Client;
            }),
        };
    });

    it("discovers tools and creates resource tools with safe names", async () => {
        const provider = new McpServerToolProvider(mockFactory);
        const agent = createAgent("agent-a", "agent-a");

        const tools = await provider.getAllTools(agent);
        expect(tools.length).toBe(4);

        const toolNames = tools.map((t) => t.name);
        expect(toolNames).toContain("test_server_tools_echo");
        expect(toolNames).toContain("test_server_tools_no_args");
        expect(toolNames).toContain("test_server_read_resource");
        expect(toolNames).toContain("test_server_list_resources");

        const noArgsTool = tools.find(
            (t) => t.name === "test_server_tools_no_args",
        );
        expect(noArgsTool?.inputSchema.properties).toEqual({});
        expect(noArgsTool?.inputSchema.required).toBeNull();
    });

    it("retrieves a tool by name using getToolByName", async () => {
        const provider = new McpServerToolProvider(mockFactory);
        const agent = createAgent("agent-a", "agent-a");

        const tool = await provider.getToolByName(
            "test_server_tools_echo",
            agent,
        );
        expect(tool).not.toBeNull();
        expect(tool?.name).toBe("test_server_tools_echo");

        const nonExistent = await provider.getToolByName("non_existent", agent);
        expect(nonExistent).toBeNull();
    });

    it("executes an MCP tool and delegates to client.callTool", async () => {
        const provider = new McpServerToolProvider(mockFactory);
        const agent = createAgent("agent-a", "agent-a");

        const tool = await provider.getToolByName(
            "test_server_tools_echo",
            agent,
        );
        const fakeSession = { agent } as unknown as AgentSession;

        const result = await tool!.execute({ message: "hello" }, fakeSession);

        expect(result).toEqual([{ type: "text", text: "echoed: hello" }]);
        expect(mockClientA.callTool).toHaveBeenCalledWith({
            name: "echo",
            arguments: { message: "hello" },
        });
        expect(mockClientA.close).toHaveBeenCalled();
    });

    it("throws an error when callTool returns isError: true", async () => {
        mockClientA.callTool.mockResolvedValueOnce({
            isError: true,
            content: [{ type: "text", text: "Something went wrong" }],
        });

        const provider = new McpServerToolProvider(mockFactory);
        const agent = createAgent("agent-a", "agent-a");
        const tool = await provider.getToolByName(
            "test_server_tools_echo",
            agent,
        );
        const fakeSession = { agent } as unknown as AgentSession;

        expect(tool!.execute({ message: "err" }, fakeSession)).rejects.toThrow(
            "MCP tool error",
        );
        expect(mockClientA.close).toHaveBeenCalled();
    });

    it("executes read_resource and calls client.readResource", async () => {
        const provider = new McpServerToolProvider(mockFactory);
        const agent = createAgent("agent-a", "agent-a");

        const readResourceTool = await provider.getToolByName(
            "test_server_read_resource",
            agent,
        );
        const fakeSession = { agent } as unknown as AgentSession;

        const contents = await readResourceTool!.execute(
            { uri: "file:///config.json" },
            fakeSession,
        );

        expect(contents).toEqual([
            { uri: "file:///config.json", text: '{"key": "value"}' },
        ]);
        expect(mockClientA.readResource).toHaveBeenCalledWith({
            uri: "file:///config.json",
        });
        expect(mockClientA.close).toHaveBeenCalled();
    });

    it("executes list_resources and returns listed resources", async () => {
        const provider = new McpServerToolProvider(mockFactory);
        const agent = createAgent("agent-a", "agent-a");

        const listResourceTool = await provider.getToolByName(
            "test_server_list_resources",
            agent,
        );
        const fakeSession = { agent } as unknown as AgentSession;

        const resources = await listResourceTool!.execute({}, fakeSession);
        expect(resources).toEqual([
            {
                uri: "file:///config.json",
                name: "Config File",
                mimeType: "application/json",
            },
        ]);
    });

    it("isolates tools per agent and does not leak execution closures across agents", async () => {
        const provider = new McpServerToolProvider(mockFactory);
        const agentA = createAgent("agent-a", "agent-a");
        const agentB = createAgent("agent-b", "agent-b");

        const toolsA = await provider.getAllTools(agentA);
        const toolsB = await provider.getAllTools(agentB);

        const echoA = toolsA.find((t) => t.name === "test_server_tools_echo");
        const toolB = toolsB.find(
            (t) => t.name === "test_server_tools_agent_b_tool",
        );

        expect(echoA).toBeDefined();
        expect(toolB).toBeDefined();

        const fakeSessionA = { agent: agentA } as unknown as AgentSession;
        const fakeSessionB = { agent: agentB } as unknown as AgentSession;

        await echoA!.execute({ message: "test" }, fakeSessionA);
        expect(mockClientA.callTool).toHaveBeenCalled();
        expect(mockClientB.callTool).not.toHaveBeenCalled();

        await toolB!.execute({}, fakeSessionB);
        expect(mockClientB.callTool).toHaveBeenCalled();
    });
});
