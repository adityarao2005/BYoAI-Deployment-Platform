package com.github.adityarao2005.harness.tools;

import java.util.List;
import java.util.concurrent.CompletableFuture;

import com.github.adityarao2005.harness.tools.error.ToolCallException;
import com.github.adityarao2005.harness.tools.error.ToolSchemaValidationException;

import jakarta.json.JsonValue;

/**
 * Represents a tool that can be executed by an agent. Each tool has a name,
 * description, and a schema that defines the expected input and output. The
 * execute method takes a list of ToolArgument objects as input and returns an
 * Object as output. If the execution fails, it throws a ToolCallException.
 */
public interface Tool {
    /**
     * Gets the name of the tool.
     * 
     * @return
     */
    String getName();

    /**
     * Gets the description of the tool.
     * 
     * @return
     */
    String getDescription();

    /**
     * Executes the tool with the given input arguments.
     * 
     * @param input A list of ToolArgument objects that represent the input to the
     *              tool.
     * @return A CompletableFuture that will be completed with the output of the
     *         tool execution.
     * @throws ToolSchemaValidationException
     * @throws ToolCallException
     */
    CompletableFuture<JsonValue> execute(List<JsonValue> input) throws ToolSchemaValidationException, ToolCallException;

    /**
     * Gets the schema of the tool, which defines the expected input and output.
     * 
     * @return A JsonValue that represents the schema of the tool.
     */
    JsonValue getSchema();
}
