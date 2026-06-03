package com.github.adityarao2005.harness.agent;

import java.util.List;
import java.util.concurrent.CompletableFuture;

import com.github.adityarao2005.harness.skills.SkillRepository;
import com.github.adityarao2005.harness.tools.ToolProvider;

/**
 * Represents an AI Agent.
 */
public interface Agent {

    /**
     * Gets the name of the agent.
     * 
     * @return
     */
    String getName();

    /**
     * Executes a task based on the given task description. The agent will use its
     * skills and tools to perform the task and return the result as a String. The
     * execution is asynchronous and returns a CompletableFuture that will be
     * completed with the result of the task execution.
     * 
     * @param taskDescription
     * @return
     */
    CompletableFuture<String> executeTask(String taskDescription);

    /**
     * Gets the list of skill repositories available to the agent.
     * 
     * @return
     */
    List<SkillRepository> getSkillRepositories();

    /**
     * Gets the list of tool providers available to the agent.
     * 
     * @return
     */
    List<ToolProvider> getToolProviders();

}
