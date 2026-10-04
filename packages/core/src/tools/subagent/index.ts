import type { SubAgentToolProviderConfig } from "@/config";
import type {
    AgentConfiguration,
    AgentHandle,
    AgentSession,
    InteractiveMode,
} from "@/agents/agents";
import type { AgentCommunicator } from "@/agents/agent.messaging";
import type { AgentObserver } from "@/agents/agent.observer";
import type { MemoryManager } from "@/agents/agent.unified_memory";
import type { ModelInteraction, ModelMessageOutput } from "@/models/conversation";
import type { Tool, ToolProvider } from "../tools";
import { constructSystemPrompt } from "@/agents/agents";
import { AgentExecutionError } from "@/errors/exceptions";
import { FilteredToolProvider } from "../filter";
import { loadSkillToolProvider } from "../load_skill";
import { z } from "zod";
import { createTool } from "../tools";
import { getLogger } from "@/logger";

const logger = getLogger("SubAgentToolProvider");

/**
 * Determines whether the computer should be inherited based on configuration flags.
 */
export function shouldInheritComputer(
    config: SubAgentToolProviderConfig,
): boolean {
    return Boolean(
        config.inheritComputer || config.allow_computer || config.shareComputer,
    );
}

/**
 * Context passed to SubAgentToolProvider so it can spawn child agents
 * using the parent's infrastructure.
 */
export interface SubAgentContext {
    /** The parent agent's configuration */
    readonly configuration: AgentConfiguration;
    /** The unified memory manager (shared with parent) */
    readonly memory: MemoryManager;
    /** The parent's communicator (for emitting subagent:* events) */
    readonly parentCommunicator: AgentCommunicator;
    /** All resolved tool providers from the parent */
    readonly parentToolProviders: ToolProvider[];
    /** Current recursion depth (0 for top-level agents) */
    readonly currentDepth: number;
    /** The root interaction ID for SSE routing */
    readonly rootAgentId?: string;
}

/**
 * Tool provider that exposes a `create_subagent` tool allowing an agent
 * to spawn child agents within the same process. Subagents inherit tools
 * from the parent (with optional per-provider filtering), run non-interactively,
 * and return their results as tool output.
 */
export class SubAgentToolProvider implements ToolProvider {
    readonly name: string = "subagent";
    private config: SubAgentToolProviderConfig;
    private context: SubAgentContext;

    constructor(
        config: SubAgentToolProviderConfig,
        context: SubAgentContext,
    ) {
        this.config = config;
        this.context = context;
    }

    async getToolByName(name: string, _agent?: AgentHandle): Promise<Tool | null> {
        const tools = await this.getAllTools(_agent);
        return tools.find((t) => t.name === name) ?? null;
    }

    async getAllTools(_agent?: AgentHandle): Promise<Tool[]> {
        const config = this.config;
        const context = this.context;

        // Don't expose the tool if we've hit max depth
        if (context.currentDepth >= config.maxDepth) {
            return [];
        }

        return [
            createTool({
                name: "create_subagent",
                description:
                    "Spawn a subagent to perform a focused sub-task. The subagent runs non-interactively with inherited tools and returns its result. Use this when a task can be cleanly decomposed into an independent sub-task.",
                inputSchema: z.object({
                    goal: z.string().describe(
                        "Clear, specific goal for the subagent to accomplish",
                    ),
                    context: z
                        .string()
                        .optional()
                        .describe(
                            "Optional additional context from the conversation to help the subagent",
                        ),
                }),
                async execute(
                    args: { goal: string; context?: string },
                    session: AgentSession,
                ) {
                    return runSubAgent(args, session, config, context);
                },
            }),
        ];
    }
}

/**
 * Runs a subagent to completion within the parent's process.
 *
 * Flow:
 * 1. Create a child AgentHandle with parentId = parent's ID
 * 2. Resolve inherited tools (applying per-provider filters)
 * 3. Seed the transcript with context + goal
 * 4. Run the agent loop until completion (no pending tool calls + model returns text)
 * 5. Return the collected output
 */
async function runSubAgent(
    args: { goal: string; context?: string },
    session: AgentSession,
    config: SubAgentToolProviderConfig,
    context: SubAgentContext,
): Promise<{ subAgentId: string; result: string }> {
    const { goal } = args;
    const parentId = session.agent.id;
    const rootAgentId = context.rootAgentId ?? session.agent.id;
    const parentCommunicator = context.parentCommunicator;
    const inheritComputer = shouldInheritComputer(config);

    // 1. Create the subagent memory entry
    const subAgentId = await context.memory.agent.createAgentMemoryEntry(
        `${session.name}-subagent`,
        session.userId,
        "non-interactive" as InteractiveMode,
        parentId,
    );

    // Share computer if configured
    if (inheritComputer && session.agent.computerId) {
        await context.memory.agent.setComputerId(
            subAgentId,
            session.agent.computerId,
        );
    }

    logger.info("Spawning subagent", {
        subAgentId,
        parentId,
        rootAgentId,
        goal: goal.substring(0, 100),
        depth: context.currentDepth + 1,
    });

    // Notify parent's communicator
    await parentCommunicator.emit("subagent:start", {
        agentId: rootAgentId,
        parentId,
        subAgentId,
        goal,
    });

    // 2. Resolve inherited tools
    const inheritedTools = await resolveInheritedTools(
        config,
        context,
        session,
        subAgentId,
    );

    // 3. Seed transcript with parent context + goal
    const seedMessages: ModelInteraction[] = [];

    // Optionally include parent conversation context
    if (args.context) {
        seedMessages.push({
            role: "user" as const,
            type: "message" as const,
            content: `Context from parent agent:\n\n${args.context}`,
        });
        seedMessages.push({
            role: "assistant" as const,
            type: "message" as const,
            content:
                "I understand the context. I'm ready to work on the task.",
        });
    }

    // The actual goal
    seedMessages.push({
        role: "user" as const,
        type: "message" as const,
        content: goal,
    });

    await context.memory.agent.addTranscriptEntries(subAgentId, seedMessages);

    // 4. Run the agent loop with timeout
    const agentMessages: string[] = [];

    try {
        await Promise.race([
            executeSubAgentLoop(
                subAgentId,
                inheritedTools,
                context,
                session,
                agentMessages,
                parentCommunicator,
                rootAgentId,
                inheritComputer,
            ),
            createTimeout(config.timeoutMs, subAgentId),
        ]);

        const finalResult =
            agentMessages.length > 0
                ? agentMessages.join("\n\n")
                : "Subagent completed task successfully.";

        await parentCommunicator.emit("subagent:complete", {
            agentId: rootAgentId,
            subAgentId,
            result: finalResult,
        });

        logger.info("Subagent completed", { subAgentId, parentId, rootAgentId });

        return { subAgentId, result: finalResult };
    } catch (error) {
        const errorMessage =
            error instanceof Error ? error.message : String(error);

        await parentCommunicator.emit("subagent:error", {
            agentId: rootAgentId,
            subAgentId,
            error: errorMessage,
        });

        logger.error("Subagent failed", { subAgentId, parentId, rootAgentId, error: errorMessage });

        return {
            subAgentId,
            result: `Subagent encountered an error: ${errorMessage}`,
        };
    }
}

/**
 * Executes the subagent turn loop until the model returns only text
 * (no more tool calls) or errors out.
 */
async function executeSubAgentLoop(
    subAgentId: string,
    tools: Tool[],
    context: SubAgentContext,
    parentSession: AgentSession,
    agentMessages: string[],
    parentCommunicator: AgentCommunicator,
    parentAgentId: string,
    inheritComputer: boolean,
    maxTurns = 50,
): Promise<void> {
    const subAgent = await context.memory.agent.getAgent(subAgentId);
    if (!subAgent) {
        throw new AgentExecutionError(
            `Subagent ${subAgentId} not found after creation`,
            { agentId: subAgentId },
        );
    }

    const skills = (
        await Promise.all(
            context.configuration.skillRepository.map((repo) =>
                repo.getAllSkills(),
            ),
        )
    ).flat();

    // Filter out tools requiring user input (subagents are non-interactive)
    const subAgentTools = tools.filter((tool) => !tool.requires_user_input);

    for (let turn = 0; turn < maxTurns; turn++) {
        const memory = await context.memory.agent.getAgentMemory(subAgentId);

        const systemPrompt = constructSystemPrompt(
            parentSession.name,
            parentSession.description,
            "non-interactive",
            skills,
            memory.skillsPath,
            context.configuration.rules ?? [],
        );

        // Notify observers
        await notifyObservers(context.configuration.observers, "onModelStart", subAgentId, systemPrompt);

        let output: ModelMessageOutput[];
        try {
            output = await context.configuration.model.execute({
                history: memory.transcript,
                systemPrompt,
                tools: subAgentTools,
            });
        } catch (error) {
            await notifyObservers(context.configuration.observers, "onError", subAgentId, error, "model:execute");
            throw error;
        }

        await notifyObservers(context.configuration.observers, "onModelEnd", subAgentId, output);

        // Add output to transcript
        await context.memory.agent.addTranscriptEntries(subAgentId, output);

        let hasToolCalls = false;

        for (const message of output) {
            if (message.type === "message") {
                agentMessages.push(message.content);

                // Forward to parent's communicator for UI rendering
                await parentCommunicator.emit("subagent:message", {
                    agentId: parentAgentId,
                    subAgentId,
                    content: message.content,
                });
            } else if (message.type === "tool_call") {
                hasToolCalls = true;

                await notifyObservers(
                    context.configuration.observers,
                    "onToolCallStart",
                    subAgentId,
                    message.id,
                    message.tool.name,
                    message.arguments as Record<string, any>,
                );

                // Execute the tool directly (no approval flow for subagents)
                const tool = subAgentTools.find(
                    (t) => t.name === message.tool.name,
                );

                let result: any;
                if (!tool) {
                    result = {
                        error: `Tool ${message.tool.name} not found.`,
                    };
                } else {
                    // Validate args
                    let validatedArgs: any = message.arguments;
                    if (
                        tool.inputSchema &&
                        typeof (tool.inputSchema as any).safeParse === "function"
                    ) {
                        const parseResult = (tool.inputSchema as any).safeParse(
                            message.arguments,
                        );
                        if (!parseResult.success) {
                            result = {
                                error: `Invalid arguments for tool ${tool.name}: ${parseResult.error.message}`,
                            };
                        } else {
                            validatedArgs = parseResult.data;
                        }
                    }

                    if (!result) {
                        // Build a session for the subagent tool execution
                        const subSession: AgentSession = {
                            agent: subAgent,
                            name: parentSession.name,
                            description: parentSession.description,
                            userId: parentSession.userId,
                            memory: memory,
                            computerProvider: inheritComputer
                                ? parentSession.computerProvider
                                : undefined,
                            skillRepositories: parentSession.skillRepositories,
                            authContext: parentSession.authContext,
                            mode: "non-interactive",
                            rules: parentSession.rules,
                        };

                        try {
                            result = await tool.execute(validatedArgs, subSession);
                        } catch (err: any) {
                            result = {
                                error: err?.message ?? String(err),
                            };
                        }
                    }
                }

                await notifyObservers(
                    context.configuration.observers,
                    "onToolCallEnd",
                    subAgentId,
                    message.id,
                    message.tool.name,
                    result,
                );

                // Record tool response in transcript
                const toolRef: Tool = tool ?? {
                    name: message.tool.name,
                    description: "",
                    inputSchema: z.object({}),
                    execute: async () => {},
                };

                await context.memory.agent.addTranscriptEntries(subAgentId, [
                    {
                        type: "tool_response" as const,
                        result,
                        tool: toolRef,
                        id: message.id,
                    },
                ]);
            }
        }

        // If no tool calls were made, the agent is done
        if (!hasToolCalls) {
            await notifyObservers(context.configuration.observers, "onTurnEnd", subAgentId);
            return;
        }
    }

    throw new AgentExecutionError(
        `Subagent ${subAgentId} exceeded maximum turn limit (${maxTurns})`,
        { agentId: subAgentId },
    );
}

/**
 * Resolves which tools the subagent should have access to based on:
 * 1. Automatic skills loading (always included)
 * 2. Computer use tool (only if inheritComputer / allow_computer is true)
 * 3. Recursive subagent tool (only if allowRecursive is true and depth limit not reached)
 * 4. Inherited tool providers (all if undefined, or filtered per config)
 */
async function resolveInheritedTools(
    config: SubAgentToolProviderConfig,
    context: SubAgentContext,
    parentSession: AgentSession,
    subAgentId: string,
): Promise<Tool[]> {
    const subAgentHandle: AgentHandle = (await context.memory.agent.getAgent(
        subAgentId,
    ))!;
    const allProviders = context.parentToolProviders;
    const inheritComputer = shouldInheritComputer(config);

    const toolsByName = new Map<string, Tool>();

    // 1. Skill loading is always automatic in subagents
    const skillRepos =
        parentSession.skillRepositories ??
        context.configuration.skillRepository;
    if (skillRepos && skillRepos.length > 0) {
        const skillsProvider = loadSkillToolProvider(skillRepos);
        const skillTools = await skillsProvider.getAllTools(subAgentHandle);
        for (const tool of skillTools) {
            toolsByName.set(tool.name, tool);
        }
    }

    // 2. Recursive subagent tool if allowed and not at max depth
    const nextDepth = context.currentDepth + 1;
    if (config.allowRecursive && nextDepth < config.maxDepth) {
        const childContext: SubAgentContext = {
            ...context,
            currentDepth: nextDepth,
            rootAgentId: context.rootAgentId ?? parentSession.agent.id,
        };
        const childSubAgentProvider = new SubAgentToolProvider(
            config,
            childContext,
        );
        const childTools = await childSubAgentProvider.getAllTools(subAgentHandle);
        for (const tool of childTools) {
            toolsByName.set(tool.name, tool);
        }
    }

    // Helper to check provider category
    const isSkillsProvider = (p: ToolProvider) =>
        p.name === "skills" || p.name === "load_skill";
    const isComputerProvider = (p: ToolProvider) =>
        p.name === "computer" || (p as any).constructor?.name === "ComputerUseToolProvider";
    const isSubAgentProvider = (p: ToolProvider) =>
        p.name === "subagent" || p instanceof SubAgentToolProvider;

    // 3. Other tool providers:
    // If no inheritedToolProviders specified, inherit all other providers
    if (!config.inheritedToolProviders) {
        for (const provider of allProviders) {
            // Skills already handled
            if (isSkillsProvider(provider)) continue;
            // Subagent recursion already handled
            if (isSubAgentProvider(provider)) continue;
            // Computer only if inheritComputer is true
            if (isComputerProvider(provider) && !inheritComputer) continue;

            const providerTools = await provider.getAllTools(subAgentHandle);
            for (const tool of providerTools) {
                toolsByName.set(tool.name, tool);
            }
        }
    } else {
        // Inherit explicitly listed tool providers
        const providerNameMap = buildProviderNameMap(allProviders);

        for (const filter of config.inheritedToolProviders) {
            if (!filter.name) continue;

            // Skills are already added automatically
            if (filter.name === "skills" || filter.name === "load_skill") {
                continue;
            }

            const provider =
                providerNameMap.get(filter.name) ??
                providerNameMap.get(filter.name.toLowerCase());

            if (!provider) {
                logger.warn(
                    `Inherited tool provider '${filter.name}' not found, skipping`,
                );
                continue;
            }

            // If it's a computer provider, inheritComputer must be true
            if (isComputerProvider(provider) && !inheritComputer) {
                logger.warn(
                    `Tool provider '${filter.name}' is a computer provider, but inheritComputer is false. Skipping.`,
                );
                continue;
            }

            const hasFilters =
                (filter.allowedTools && filter.allowedTools.length > 0) ||
                (filter.disallowedTools && filter.disallowedTools.length > 0);

            let providerTools: Tool[];
            if (hasFilters) {
                const filtered = new FilteredToolProvider(provider, {
                    allowedTools: filter.allowedTools,
                    disallowedTools: filter.disallowedTools,
                });
                providerTools = await filtered.getAllTools(subAgentHandle);
            } else {
                providerTools = await provider.getAllTools(subAgentHandle);
            }

            for (const tool of providerTools) {
                toolsByName.set(tool.name, tool);
            }
        }
    }

    return Array.from(toolsByName.values());
}

/**
 * Builds a name-to-provider map. Indexes providers by:
 * - provider.name
 * - innerProvider.name (if FilteredToolProvider)
 * - provider.config.name (for OpenAPI/MCP)
 */
function buildProviderNameMap(
    providers: ToolProvider[],
): Map<string, ToolProvider> {
    const map = new Map<string, ToolProvider>();

    for (const provider of providers) {
        let name: string | undefined = provider.name;
        if (!name && (provider as any).innerProvider?.name) {
            name = (provider as any).innerProvider.name;
        }
        if (!name && (provider as any).provider?.name) {
            name = (provider as any).provider.name;
        }
        if (!name && (provider as any).config?.name) {
            name = (provider as any).config.name;
        }

        if (typeof name === "string" && name.length > 0) {
            map.set(name, provider);
            map.set(name.toLowerCase(), provider);
        }
    }

    return map;
}

/**
 * Creates a timeout promise that rejects after the specified duration.
 */
function createTimeout(
    timeoutMs: number,
    subAgentId: string,
): Promise<never> {
    return new Promise((_, reject) => {
        setTimeout(() => {
            reject(
                new AgentExecutionError(
                    `Subagent ${subAgentId} timed out after ${timeoutMs}ms`,
                    { agentId: subAgentId },
                ),
            );
        }, timeoutMs);
    });
}

/**
 * Helper to notify observers without disrupting execution.
 */
async function notifyObservers<K extends keyof AgentObserver>(
    observers: AgentObserver[] | undefined,
    method: K,
    ...args: Parameters<NonNullable<AgentObserver[K]>>
): Promise<void> {
    if (!observers) return;
    for (const observer of observers) {
        try {
            const fn = observer[method] as any;
            if (typeof fn === "function") {
                await fn.apply(observer, args);
            }
        } catch {
            // Observers must not disrupt agent execution
        }
    }
}
