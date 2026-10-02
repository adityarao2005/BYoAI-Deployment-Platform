import type { AgentHandle, AgentSession } from "@/agents";
import { z } from "zod";

/**
 * Represents an executable tool for an agent.
 * Each tool has a name, description, Zod schema for input arguments, and an `execute` function.
 */
export interface Tool<TSchema extends z.ZodType = z.ZodType> {
    name: string;
    description?: string;
    inputSchema: TSchema;
    requires_user_input?: boolean;

    /**
     * Executes the tool call given input arguments and session context.
     * @param args - The typed tool input arguments derived from TSchema.
     * @param session - The agent execution session.
     */
    execute(args: z.infer<TSchema>, session: AgentSession): Promise<any>;
}

/**
 * Helper to construct a strongly typed Tool without having to manually specify generic parameters.
 */
export function createTool<TSchema extends z.ZodType>(
    tool: Tool<TSchema>,
): Tool<TSchema> {
    return tool;
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

    clear() {
        this.registry = [];
    }
}

export const toolProviderRegistry: ToolProviderRegistry =
    new ToolProviderRegistry();
