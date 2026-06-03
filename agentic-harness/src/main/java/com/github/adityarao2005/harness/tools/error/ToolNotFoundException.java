package com.github.adityarao2005.harness.tools.error;

/**
 * Exception thrown when a tool is not found.
 */
public class ToolNotFoundException extends ToolCallException {
    public ToolNotFoundException(String message) {
        super(message);
    }
}
