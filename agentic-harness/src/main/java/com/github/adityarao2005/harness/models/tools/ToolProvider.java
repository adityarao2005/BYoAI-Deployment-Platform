package com.github.adityarao2005.harness.models.tools;

import java.util.List;

import com.github.adityarao2005.harness.models.tools.error.ToolNotFoundException;

/**
 * Provides access to a collection of available tools.
 */
public interface ToolProvider {
    /**
     * Gets a list of all available tools.
     * 
     * @return A list of Tool objects that represent the available tools.
     */
    List<Tool> getTools();

    /**
     * Gets a tool by its name. If the tool is not found, it throws a
     * ToolNotFoundException.
     * 
     * @param name The name of the tool to retrieve.
     * @return
     * @throws ToolNotFoundException
     */
    Tool getToolByName(String name) throws ToolNotFoundException;
}
