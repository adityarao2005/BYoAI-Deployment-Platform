import { ToolObjectArgument } from "./tool_argument";


/*
Represents a tool that can be executed by an agent. Each tool has a name,
description, and a schema that defines the expected input and output. The
execute method takes a list of ToolArgument objects as input and returns an
Object as output. If the execution fails, it throws a ToolCallException.
*/
export interface Tool {
    name: string;
    description: string;
    inputSchema: ToolObjectArgument; // JSON Schema for input validation

    /**
     * executes the tool call given the arguments
     * @param args the tool arguments
     */
    execute(args: Record<string, any>): Promise<any>;
}

/*
Provides access to a collection of available tools.
*/
export interface ToolProvider {
    /**
     * Get the tool by name. Returns null if the tool is not found.
     * @param name name of thet tool
     */
    getToolByName(name: string): Promise<Tool | null>;

    /**
     * Get all the tools available in the provider.
     */
    getAllTools(): Promise<Tool[]>;
}


export class ToolProviderRegistry {
    private registry: ToolProvider[] = [];

    registerToolProvider(provider: ToolProvider) {
        this.registry.push(provider);
    }

    getAllToolProviders(): ToolProvider[] {
        return this.registry;
    }
}

export const toolProviderRegistry: ToolProviderRegistry = new ToolProviderRegistry();