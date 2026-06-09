
/*
Represents a tool that can be executed by an agent. Each tool has a name,
description, and a schema that defines the expected input and output. The
execute method takes a list of ToolArgument objects as input and returns an
Object as output. If the execution fails, it throws a ToolCallException.
*/
export interface Tool {
    name: string;
    description: string;
    schema: object; // JSON Schema for input validation

    execute(args: object[]): Promise<object>;
}

/*
Provides access to a collection of available tools.
TODO: Define the different tool provider methods
*/
export interface ToolProvider {
    getToolByName(name: string): Promise<Tool | null>;
    getAllTools(): Promise<Tool[]>;
}