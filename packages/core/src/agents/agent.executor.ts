import type {
    ModelMessageOutput,
} from "@/models/conversation";
import type { Skill } from "@/skills";
import { z } from "zod";
import type { Tool } from "@/tools/tools";
import type { AgentConfiguration, AgentSession } from "./agents";
import { constructSystemPrompt } from "./agents";
import type { AgentObserver } from "./agent.observer";
import { AgentExecutionError } from "@/errors/exceptions";
import {
    type MemoryManager,
    normalizeMemoryManager,
} from "./agent.unified_memory";

/**
 * Interface representing the core agent runtime execution capabilities.
 */
export interface IAgentExecutor {
    init(): Promise<void>;
    sendMessage(agentId: string, message: string): Promise<void>;
    runTurn(agentId: string): Promise<void>;
    handleToolCall(
        agentId: string,
        toolCallId: string,
        toolName: string,
        args: Record<string, any>,
    ): Promise<void>;
    handleToolResponse(
        agentId: string,
        toolName: string,
        toolCallId: string,
        result: any,
        skipRun?: boolean,
    ): Promise<void>;
    createAgentSession(agentId: string): Promise<{
        session: AgentSession;
        tools: Tool[];
    }>;
    acceptToolCall(agentId: string, toolCallId: string): Promise<void>;
    rejectToolCall(
        agentId: string,
        toolCallId: string,
        reason?: string,
    ): Promise<void>;
}

/**
 * Executor responsible for agent turn execution loops, prompt construction,
 * model interaction, tool resolution, and observer notifications.
 */
export class AgentExecutor implements IAgentExecutor {
    private configuration: AgentConfiguration;
    private memory: MemoryManager;
    private skills: Skill[] = [];
    private tools: Tool[] | undefined = undefined;

    constructor(configuration: AgentConfiguration, memory?: MemoryManager) {
        this.configuration = configuration;
        this.memory =
            memory ??
            normalizeMemoryManager(configuration.memoryManager, {
                userTokenManager: configuration.userTokenManager,
                computerLifecycleManager:
                    configuration.computerLifecycleManager,
            });
    }

    async notifyError(
        agentId: string,
        error: unknown,
        context: string,
    ): Promise<void> {
        await this.notifyObservers("onError", agentId, error, context);
    }

    private async notifyObservers<K extends keyof AgentObserver>(
        method: K,
        ...args: Parameters<NonNullable<AgentObserver[K]>>
    ): Promise<void> {
        if (!this.configuration.observers) return;
        for (const observer of this.configuration.observers) {
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

    async init(): Promise<void> {
        // Gather all skills
        this.skills = (
            await Promise.all(
                this.configuration.skillRepository.map((repo) =>
                    repo.getAllSkills(),
                ),
            )
        ).flat();
    }

    async createAgentSession(agentId: string): Promise<{
        session: AgentSession;
        tools: Tool[];
    }> {
        const agent = await this.memory.agent.getAgent(agentId);
        if (!agent) {
            throw new AgentExecutionError(
                `The agent ${agentId} should exist before creating a new session`,
                { agentId },
            );
        }
        const memory =
            await this.memory.agent.getAgentMemory(agentId);

        if (this.tools === undefined) {
            this.tools = (
                await Promise.all(
                    this.configuration.toolProviders.map((provider) =>
                        provider.getAllTools(agent),
                    ),
                )
            ).flat();
        }

        const authContext = await this.memory.userToken.getUserToken(
            agent.userId,
        );

        return {
            session: {
                agent,
                name: this.configuration.name,
                description: this.configuration.description,
                userId: agent.userId,
                memory,
                computerProvider: this.configuration.computerProvider,
                skillRepositories: this.configuration.skillRepository,
                authContext,
                mode: memory.mode ?? "interactive",
                rules: this.configuration.rules ?? [],
            },
            tools: this.tools ?? [],
        };
    }

    async sendMessage(agentId: string, message: string): Promise<void> {
        const memory =
            await this.memory.agent.getAgentMemory(agentId);
        if (memory.mode === "non-interactive" && memory.transcript.length > 0) {
            throw new AgentExecutionError(
                `Cannot send message to non-interactive agent ${agentId} with existing transcript messages`,
                { agentId },
            );
        }
        await this.notifyObservers("onTurnStart", agentId, message);
        await this.memory.agent.addTranscriptEntries(agentId, [
            {
                role: "user",
                type: "message",
                content: message,
            },
        ]);

        await this.configuration.communicator.emit("agent:run", {
            agentId,
        });
    }

    async runTurn(agentId: string): Promise<void> {
        const { session, tools } = await this.createAgentSession(agentId);
        const memory =
            await this.memory.agent.getAgentMemory(agentId);

        const prompt = constructSystemPrompt(
            session.name,
            session.description,
            session.mode,
            this.skills,
            memory.skillsPath,
            this.configuration.rules ?? [],
        );

        await this.notifyObservers("onModelStart", agentId, prompt);

        const toolsForModel =
            session.mode === "non-interactive"
                ? tools.filter((tool) => !tool.requires_user_input)
                : tools;

        let output: ModelMessageOutput[];
        try {
            output = await this.configuration.model.execute({
                history: memory.transcript,
                systemPrompt: prompt,
                tools: toolsForModel,
            });
        } catch (error) {
            await this.notifyObservers("onTurnEnd", agentId, error);
            await this.notifyObservers(
                "onError",
                agentId,
                error,
                "model:execute",
            );
            throw error;
        }

        await this.notifyObservers("onModelEnd", agentId, output);

        await this.memory.agent.addTranscriptEntries(
            agentId,
            output,
        );

        let toolCallsPending = false;

        for (const message of output) {
            if (message.type === "message") {
                await this.notifyObservers(
                    "onAgentMessage",
                    agentId,
                    message.content,
                );
                await this.configuration.communicator.emit("agent:message", {
                    agentId,
                    content: message.content,
                });
            } else if (message.type === "tool_call") {
                toolCallsPending = true;
                await this.notifyObservers(
                    "onToolCallStart",
                    agentId,
                    message.id,
                    message.tool.name,
                    message.arguments,
                );
                await this.configuration.communicator.emit("tool:call", {
                    agentId,
                    toolCallId: message.id,
                    tool: message.tool.name,
                    args: message.arguments,
                });
            }
        }

        if (!toolCallsPending) {
            await this.notifyObservers("onTurnEnd", agentId);
            await this.configuration.communicator.emit("agent:complete", {
                agentId,
            });
        }
    }

    async handleToolCall(
        agentId: string,
        toolCallId: string,
        toolName: string,
        args: Record<string, any>,
    ): Promise<void> {
        const { session, tools } = await this.createAgentSession(agentId);
        const tool = tools.find((t) => t.name === toolName);

        if (!tool) {
            const errorResult = { error: `Tool ${toolName} not found.` };
            await this.notifyObservers(
                "onToolCallEnd",
                agentId,
                toolCallId,
                toolName,
                errorResult,
            );
            await this.configuration.communicator.emit("tool:complete", {
                agentId,
                toolCallId,
                tool: toolName,
                result: errorResult,
            });
            return;
        }

        let validatedArgs: any = args;
        if (
            tool.inputSchema &&
            typeof (tool.inputSchema as any).safeParse === "function"
        ) {
            const parseResult = (tool.inputSchema as any).safeParse(args);
            if (!parseResult.success) {
                const errorResult = {
                    error: `Invalid arguments for tool ${tool.name}: ${parseResult.error.message}`,
                };
                await this.notifyObservers(
                    "onToolCallEnd",
                    agentId,
                    toolCallId,
                    tool.name,
                    errorResult,
                );
                await this.configuration.communicator.emit("tool:complete", {
                    agentId,
                    toolCallId,
                    tool: tool.name,
                    result: errorResult,
                });
                return;
            }
            validatedArgs = parseResult.data;
        }

        if (tool.requires_user_input) {
            if (session.mode === "interactive") {
                await this.configuration.communicator.emit(
                    "tool:approval_required",
                    {
                        agentId,
                        toolCallId,
                        tool: tool.name,
                        args: validatedArgs,
                    },
                );
                return;
            }

            const errorResult = {
                error: `Tool ${tool.name} requires user confirmation and is not available in non-interactive mode.`,
            };
            await this.notifyObservers(
                "onToolCallEnd",
                agentId,
                toolCallId,
                tool.name,
                errorResult,
            );
            await this.configuration.communicator.emit("tool:complete", {
                agentId,
                toolCallId,
                tool: tool.name,
                result: errorResult,
            });
            return;
        }

        await this.executeTool(agentId, toolCallId, tool, session, validatedArgs);
    }

    private async executeTool(
        agentId: string,
        toolCallId: string,
        tool: Tool,
        session: AgentSession,
        args: Record<string, any>,
    ): Promise<void> {
        try {
            const output = await tool.execute(args, session);
            await this.notifyObservers(
                "onToolCallEnd",
                agentId,
                toolCallId,
                tool.name,
                output,
            );
            await this.configuration.communicator.emit("tool:complete", {
                agentId,
                toolCallId,
                tool: tool.name,
                result: output,
            });
        } catch (err: any) {
            const errorResult = { error: err?.message ?? String(err) };
            await this.notifyObservers(
                "onToolCallEnd",
                agentId,
                toolCallId,
                tool.name,
                errorResult,
                err,
            );
            await this.configuration.communicator.emit("tool:complete", {
                agentId,
                toolCallId,
                tool: tool.name,
                result: errorResult,
            });
        }
    }

    async handleToolResponse(
        agentId: string,
        toolName: string,
        toolCallId: string,
        result: any,
        skipRun = false,
    ): Promise<void> {
        const memory =
            await this.memory.agent.getAgentMemory(agentId);

        const existing = memory.transcript.find(
            (e) => e.type === "tool_response" && e.id === toolCallId,
        );
        if (existing) {
            return;
        }

        const { tools } = await this.createAgentSession(agentId);
        const matchingTool = tools.find((t) => t.name === toolName);

        const toolRef: Tool = matchingTool ?? {
            name: toolName,
            description: "",
            inputSchema: z.object({}),
            execute: async () => {},
        };

        await this.memory.agent.addTranscriptEntries(agentId, [
            {
                type: "tool_response",
                result,
                tool: toolRef,
                id: toolCallId,
            },
        ]);

        const updatedMemory =
            await this.memory.agent.getAgentMemory(agentId);

        if (!skipRun && updatedMemory.getPendingToolCalls().length === 0) {
            await this.configuration.communicator.emit("agent:run", {
                agentId,
            });
        }
    }

    async acceptToolCall(
        agentId: string,
        toolCallId: string,
    ): Promise<void> {
        const memory =
            await this.memory.agent.getAgentMemory(agentId);
        const pendingCalls = memory.getPendingToolCalls();
        if (!pendingCalls.includes(toolCallId)) {
            throw new AgentExecutionError(
                `No pending tool call with ID ${toolCallId} found for agent ${agentId}`,
                { agentId },
            );
        }

        const toolCall = memory.transcript.find(
            (entry) => entry.type === "tool_call" && entry.id === toolCallId,
        );
        if (!toolCall || toolCall.type !== "tool_call") {
            throw new AgentExecutionError(
                `Tool call ${toolCallId} not found in transcript for agent ${agentId}`,
                { agentId },
            );
        }

        const { session, tools } = await this.createAgentSession(agentId);
        const tool = tools.find((t) => t.name === toolCall.tool.name);
        if (!tool) {
            throw new AgentExecutionError(
                `Tool ${toolCall.tool.name} not found for agent ${agentId}`,
                { agentId },
            );
        }

        await this.executeTool(
            agentId,
            toolCallId,
            tool,
            session,
            toolCall.arguments,
        );
    }

    async rejectToolCall(
        agentId: string,
        toolCallId: string,
        reason?: string,
    ): Promise<void> {
        const memory =
            await this.memory.agent.getAgentMemory(agentId);
        const pendingCalls = memory.getPendingToolCalls();
        if (!pendingCalls.includes(toolCallId)) {
            throw new AgentExecutionError(
                `No pending tool call with ID ${toolCallId} found for agent ${agentId}`,
                { agentId },
            );
        }

        const toolCall = memory.transcript.find(
            (entry) => entry.type === "tool_call" && entry.id === toolCallId,
        );
        if (!toolCall || toolCall.type !== "tool_call") {
            throw new AgentExecutionError(
                `Tool call ${toolCallId} not found in transcript for agent ${agentId}`,
                { agentId },
            );
        }

        const rejectionMessage = reason ?? "rejected";
        const result = {
            rejected: true,
            message: rejectionMessage,
        };

        await this.notifyObservers(
            "onToolCallEnd",
            agentId,
            toolCallId,
            toolCall.tool.name,
            result,
        );

        await this.handleToolResponse(
            agentId,
            toolCall.tool.name,
            toolCallId,
            result,
            true,
        );

        await this.configuration.communicator.emit("tool:complete", {
            agentId,
            toolCallId,
            tool: toolCall.tool.name,
            result,
        });

        await this.sendMessage(agentId, rejectionMessage);
    }
}
