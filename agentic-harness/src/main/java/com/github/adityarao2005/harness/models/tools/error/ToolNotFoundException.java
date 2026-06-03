package com.github.adityarao2005.harness.models.tools.error;

/**
 * Exception thrown when a tool is not found.
 */
public class ToolNotFoundException extends ToolCallException {
    public ToolNotFoundException(String message) {
        super(message);
    }
}
