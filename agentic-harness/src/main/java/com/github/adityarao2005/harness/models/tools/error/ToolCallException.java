package com.github.adityarao2005.harness.models.tools.error;

/**
 * Exception thrown when a tool call fails.
 */
public class ToolCallException extends Exception {

    public ToolCallException(String message) {
        super(message);
    }

    public ToolCallException(String message, Throwable cause) {
        super(message, cause);
    }
}
