package com.github.adityarao2005.harness.models.tools.error;

/**
 * Exception thrown when a tool's schema validation fails.
 */
public class ToolSchemaValidationException extends ToolCallException {

    public ToolSchemaValidationException(String message) {
        super(message);
    }

    public ToolSchemaValidationException(String message, Throwable cause) {
        super(message, cause);
    }
}
