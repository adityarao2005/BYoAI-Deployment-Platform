import type {
    ModelMessageOutput,
} from "@/models/conversation";
import type { Skill } from "@/skills";
import { validateToolArgument } from "@/tools/tool_argument";
import type { Tool } from "@/tools/tools";
import type { AgentConfiguration, AgentSession } from "./agents";
import { constructSystemPrompt } from "./agents";
import type { AgentObserver } from "./agent.observer";
import { AgentExecutionError } from "@/errors/exceptions";

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
    ): Promise<void>;
    createAgentSession(agentId: string): Promise<{
        session: AgentSession;
        tools: Tool[];
    }>;
}

/**
 * Executor responsible for agent turn execution loops, prompt construction,
 * model interaction, tool resolution, and observer notifications.
 */
export class AgentExecutor implements IAgentExecutor {
    private configuration: AgentConfiguration;
    private skills: Skill[] = [];
    private tools: Tool[] | undefined = undefined;

    constructor(configuration: AgentConfiguration) {
        this.configuration = configuration;
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
        const agent = await this.configuration.memoryManager.getAgent(agentId);
        if (!agent) {
            throw new AgentExecutionError(
                `The agent ${agentId} should exist before creating a new session`,
                { agentId },
            );
        }
        const memory =
            await this.configuration.memoryManager.getAgentMemory(agentId);

        if (this.tools === undefined) {
            this.tools = (
                await Promise.all(
                    this.configuration.toolProviders.map((provider) =>
                        provider.getAllTools(agent),
                    ),
                )
            ).flat();
        }

        return {
            session: {
                agent,
                name: this.configuration.name,
                description: this.configuration.description,
                userId: agent.userId,
                memory,
                computerProvider: this.configuration.computerProvider,
                skillRepositories: this.configuration.skillRepository,
            },
            tools: this.tools ?? [],
        };
    }

    async sendMessage(agentId: string, message: string): Promise<void> {
        await this.notifyObservers("onTurnStart", agentId, message);
        await this.configuration.memoryManager.addTranscriptEntries(agentId, [
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
            await this.configuration.memoryManager.getAgentMemory(agentId);

        const prompt = constructSystemPrompt(
            session.name,
            session.description,
            this.skills,
        );

        await this.notifyObservers("onModelStart", agentId, prompt);

        let output: ModelMessageOutput[];
        try {
            output = await this.configuration.model.execute({
                history: memory.transcript,
                systemPrompt: prompt,
                tools,
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

        await this.configuration.memoryManager.addTranscriptEntries(
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

        if (!validateToolArgument(tool.inputSchema, args)) {
            const errorResult = {
                error: `Invalid arguments for tool ${tool.name}`,
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
    ): Promise<void> {
        const { tools } = await this.createAgentSession(agentId);
        const matchingTool = tools.find((t) => t.name === toolName);

        const toolRef: Tool = matchingTool ?? {
            name: toolName,
            description: "",
            inputSchema: { type: "object", description: "", properties: {} },
            execute: async () => {},
        };

        await this.configuration.memoryManager.addTranscriptEntries(agentId, [
            {
                type: "tool_response",
                result,
                tool: toolRef,
                id: toolCallId,
            },
        ]);

        const memory =
            await this.configuration.memoryManager.getAgentMemory(agentId);

        if (memory.getPendingToolCalls().length === 0) {
            await this.configuration.communicator.emit("agent:run", {
                agentId,
            });
        }
    }
}
