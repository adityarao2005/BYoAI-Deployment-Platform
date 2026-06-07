package tools

/*
Represents a tool that can be executed by an agent. Each tool has a name,
description, and a schema that defines the expected input and output. The
execute method takes a list of ToolArgument objects as input and returns an
Object as output. If the execution fails, it throws a ToolCallException.
*/
type Tool interface {

	/*
	   Gets the name of the tool.
	*/
	GetName() string

	/*
	   Gets the description of the tool.
	*/
	GetDescription() string

	/*
	   Gets the schema of the tool, which defines the expected input and output.
	*/
	GetSchema() map[string]any

	/*
	   Executes the tool with the given arguments.
	*/
	Execute(args []map[string]any) (map[string]any, error)
}

/*
Provides access to a collection of available tools.
TODO: Define the different tool provider methods
*/
type ToolProvider interface {
	/*
		Gets a list of all available tools.
	*/
	GetTools() ([]Tool, error)
	/*
		Gets a tool by its name.
	*/
	GetToolByName(name string) (Tool, error)
}
