import type { Client } from "@modelcontextprotocol/client";
import type { AgentHandle } from "@/agents";
import { type Tool, type ToolProvider, toolObject, toolString } from "@/tools";

export interface McpClientFactory {
    readonly name: string;

    createClient(agent: AgentHandle): Promise<Client>;
}

// mcp server tool provider, supports only tools and resources for now
export class McpServerToolProvider implements ToolProvider {
    private cachedTools: Map<string, Tool[]> = new Map();

    constructor(private clientFactory: McpClientFactory) { }

    async getToolByName(name: string, agent: AgentHandle): Promise<Tool | null> {
        const tools = await this.getAllTools(agent);
        return tools.find((tool) => tool.name === name) || null;
    }

    private async getToolsAndResources(agent: AgentHandle) {
        const client = await this.clientFactory.createClient(agent);
        try {
            const { tools } = await client.listTools();
            const { resources } = await client.listResources();

            return {
                tools,
                resources,
            };
        } finally {
            if (typeof client?.close === "function") {
                await client.close();
            }
        }
    }

    private async executeMcpTool(
        agent: AgentHandle,
        toolName: string,
        args: Record<string, any>,
    ) {
        const client = await this.clientFactory.createClient(agent);
        try {
            const result = await client.callTool({
                name: toolName,
                arguments: args,
            });

            if (result.isError) {
                throw new Error(
                    `MCP tool error: ${JSON.stringify(result.content)}`,
                );
            }

            return result.content;
        } finally {
            if (typeof client?.close === "function") {
                await client.close();
            }
        }
    }

    private async readMcpResource(agent: AgentHandle, uri: string) {
        const client = await this.clientFactory.createClient(agent);
        try {
            const result = await client.readResource({ uri });
            return result.contents;
        } finally {
            if (typeof client?.close === "function") {
                await client.close();
            }
        }
    }

    async getAllTools(agent: AgentHandle): Promise<Tool[]> {
        const cacheKey = agent.name ?? agent.id;
        const cached = this.cachedTools.get(cacheKey);
        if (cached !== undefined) {
            return cached;
        }

        const { tools, resources } = await this.getToolsAndResources(agent);
        const agentTools: Tool[] = [];

        for (const tool of tools) {
            const properties =
                (tool.inputSchema?.properties as Record<string, any>) ?? {};
            const required = Array.isArray(tool.inputSchema?.required)
                ? tool.inputSchema.required
                : null;

            agentTools.push({
                description: tool.description,
                name: `${this.clientFactory.name}_tools_${tool.name}`,
                inputSchema: {
                    properties,
                    type: "object",
                    description: tool.description || "Input schema",
                    required,
                },
                execute: async (args: Record<string, any>) => {
                    return await this.executeMcpTool(agent, tool.name, args);
                },
            });
        }

        // add tool for reading resource
        agentTools.push({
            description: `Retrieves an MCP resource associated with the mcp server ${this.clientFactory.name} and the provided URI`,
            name: `${this.clientFactory.name}_read_resource`,
            inputSchema: toolObject("Schema Object for tool call input", {
                uri: toolString("URI of the resource"),
            }),
            execute: async ({ uri }: { uri: string }) => {
                return await this.readMcpResource(agent, uri);
            },
        });

        // add tool for listing resources
        agentTools.push({
            description: `Lists the MCP resources associated with the mcp server ${this.clientFactory.name}`,
            name: `${this.clientFactory.name}_list_resources`,
            inputSchema: toolObject("Schema Object for tool call input", {}),
            execute: async () => {
                return resources;
            },
        });

        this.cachedTools.set(cacheKey, agentTools);
        return agentTools;
    }
}
