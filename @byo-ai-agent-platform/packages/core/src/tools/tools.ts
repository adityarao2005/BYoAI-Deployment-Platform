import type { AgentHandle, AgentSession } from "@/agents";
import type { ToolObjectArgument } from "./tool_argument";

/**
 * Represents an executable tool for an agent.
 * Each tool has a name, description, schema for input arguments, and an `execute` function.
 */
export interface Tool {
    name: string;
    description?: string;
    inputSchema: ToolObjectArgument; // JSON Schema for input validation

    /**
     * Executes the tool call given input arguments and session context.
     * @param args - The tool input arguments.
     * @param session - The agent execution session.
     */
    execute(args: Record<string, any>, session: AgentSession): Promise<any>;
}

/**
 * Provider interface managing a collection of tools available to agents.
 */
export interface ToolProvider {
    /**
     * Retrieves a tool by name for a specific agent. Returns null if not found.
     * @param name - Name of the tool.
     * @param agent - Optional target agent context.
     */
    getToolByName(name: string, agent?: AgentHandle): Promise<Tool | null>;

    /**
     * Retrieves all tools supplied by this provider.
     * @param agent - Optional target agent context.
     */
    getAllTools(agent?: AgentHandle): Promise<Tool[]>;
}

/**
 * Registry holding all registered tool providers in the platform.
 */
export class ToolProviderRegistry {
    private registry: ToolProvider[] = [];

    registerToolProvider(provider: ToolProvider) {
        this.registry.push(provider);
    }

    getAllToolProviders(): ToolProvider[] {
        return this.registry;
    }
}

export const toolProviderRegistry: ToolProviderRegistry =
    new ToolProviderRegistry();
