import type {
    ModelMessageOutput,
} from "@/models/conversation";
import type { Model } from "@/models/models";
import type { Skill, SkillRepository } from "@/skills";
import type { ComputerProvider } from "@/tools";
import { validateToolArgument } from "@/tools/tool_argument";
import type { Tool, ToolProvider } from "@/tools/tools";
import type { AgentMemory, AgentMemoryManager } from "./agent.memory";
import type { AgentCommunicator, AgentObserver } from "./agent.messaging";

/**
 * Plain agent identifier.
 */
export type Agent = {
    id: string;
    name: string;
    computerId?: string;
};
/**
 * Full configuration object for initializing an {@link AgentManager}.
 */
export type AgentConfiguration = {
    readonly name: string;
    readonly description: string;
    readonly model: Model;
    readonly skillRepository: SkillRepository[];
    readonly toolProviders: ToolProvider[];
    readonly memoryManager: AgentMemoryManager;
    readonly communicator: AgentCommunicator;
    readonly computerProvider?: ComputerProvider;
    readonly observers?: AgentObserver[];
};

/**
 * Constructs the system prompt string from agent metadata and available skills.
 */
export function constructSystemPrompt(
    name: string,
    description: string,
    skills: Skill[],
): string {
    return `
## Who you are:

You are an AI Agent named ${name}.

## Your purpose:

${description}

## Your skills:

<available_skills>
    ${skills
            .map((skill) =>
                `
        <skill>
            <name>${skill.frontMatter.name}</name>
            <description><![CDATA[${skill.frontMatter.description}]]></description>
        </skill>`.trim(),
            )
            .join("\n")}
</available_skills>
    `.trim();
}

/**
 * Execution session context provided to tools when executed by an agent.
 */
export interface AgentSession {
    readonly agent: Agent;
    readonly name: string;
    readonly description: string;
    readonly memory: AgentMemory;
    readonly computerProvider?: ComputerProvider;
    readonly skillRepositories?: SkillRepository[];
}

/**
 * Manager class orchestrating agent initialization, event subscription, model tool call loops, and execution lifecycle.
 */
export class AgentManager {
    private configuration: AgentConfiguration;
    private skills: Skill[] = [];
    private tools: Tool[] | undefined = undefined;
    private unsubscribers: Array<() => void> = [];

    constructor(configuration: AgentConfiguration) {
        this.configuration = configuration;
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

        // Subscribe to communicator events to drive agent execution
        const comm = this.configuration.communicator;

        this.unsubscribers.push(
            comm.on("agent:run", async ({ agent }) => {
                try {
                    await this.runAgent(agent);
                } catch (error) {
                    await this.notifyObservers(
                        "onError",
                        agent,
                        error,
                        "agent:run",
                    );
                    await this.configuration.communicator.emit(
                        "agent:complete",
                        {
                            agent,
                        },
                    );
                }
            }),
        );

        this.unsubscribers.push(
            comm.on("user:message", async ({ agent, content }) => {
                try {
                    await this.sendMessageToAgent(agent, content);
                } catch (error) {
                    await this.notifyObservers(
                        "onError",
                        agent,
                        error,
                        "user:message",
                    );
                    await this.configuration.communicator.emit(
                        "agent:complete",
                        {
                            agent,
                        },
                    );
                }
            }),
        );

        this.unsubscribers.push(
            comm.on("tool:call", async ({ agent, toolCallId, tool, args }) => {
                try {
                    await this.handleToolCall(agent, toolCallId, tool, args);
                } catch (error) {
                    await this.notifyObservers(
                        "onError",
                        agent,
                        error,
                        "tool:call",
                    );
                }
            }),
        );

        this.unsubscribers.push(
            comm.on(
                "tool:complete",
                async ({ agent, toolCallId, tool, result }) => {
                    try {
                        await this.handleToolResponse(
                            agent,
                            tool,
                            toolCallId,
                            result,
                        );
                    } catch (error) {
                        await this.notifyObservers(
                            "onError",
                            agent,
                            error,
                            "tool:complete",
                        );
                    }
                },
            ),
        );
    }

    destroy(): void {
        for (const unsub of this.unsubscribers) {
            unsub();
        }
        this.unsubscribers = [];
    }

    // Creates the agent
    async createAgent(): Promise<Agent> {
        const id =
            await this.configuration.memoryManager.createAgentMemoryEntry(this.configuration.name);
        let agent = await this.getAgent(id)

        if (!agent) {
            throw new Error("Something went wrong when creating the memory entry")
        }

        if (this.configuration.computerProvider) {
            // TODO: handle lifecycle differences
            const computerId =
                await this.configuration.computerProvider.createComputer();
            if (computerId) {
                await this.configuration.memoryManager.setComputerId(
                    agent,
                    computerId,
                );

                agent = await this.getAgent(id)
                if (!agent) {
                    throw new Error("Something went wrong when creating the memory entry")
                }
            }
        }

        return agent;
    }

    // Creates an agent session which will be used by the tools
    async createAgentSession(agent: Agent): Promise<{
        session: AgentSession;
        tools: Tool[];
    }> {
        const memory =
            await this.configuration.memoryManager.getAgentMemory(agent);

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
                memory,
                computerProvider: this.configuration.computerProvider,
                skillRepositories: this.configuration.skillRepository,
            },
            tools: this.tools ?? [],
        };
    }

    // Send message to agent
    async sendMessageToAgent(agent: Agent, message: string): Promise<void> {
        await this.notifyObservers("onTurnStart", agent, message);
        await this.configuration.memoryManager.addTranscriptEntries(agent, [
            {
                role: "user",
                type: "message",
                content: message,
            },
        ]);

        await this.configuration.communicator.emit("agent:run", {
            agent,
        });
    }

    // Run agent execution cycle
    async runAgent(agent: Agent): Promise<void> {
        const { session, tools } = await this.createAgentSession(agent);
        const memory =
            await this.configuration.memoryManager.getAgentMemory(agent);

        const prompt = constructSystemPrompt(
            session.name,
            session.description,
            this.skills,
        );

        await this.notifyObservers("onModelStart", agent, prompt);

        let output: ModelMessageOutput[];
        try {
            output = await this.configuration.model.execute({
                history: memory.transcript,
                systemPrompt: prompt,
                tools,
            });
        } catch (error) {
            await this.notifyObservers("onTurnEnd", agent, error);
            await this.notifyObservers("onError", agent, error, "model:execute");
            throw error;
        }

        await this.notifyObservers("onModelEnd", agent, output);

        await this.configuration.memoryManager.addTranscriptEntries(
            agent,
            output,
        );

        let toolCallsPending = false;

        for (const message of output) {
            if (message.type === "message") {
                await this.notifyObservers(
                    "onAgentMessage",
                    agent,
                    message.content,
                );
                await this.configuration.communicator.emit("agent:message", {
                    agent,
                    content: message.content,
                });
            } else if (message.type === "tool_call") {
                toolCallsPending = true;
                await this.notifyObservers(
                    "onToolCallStart",
                    agent,
                    message.id,
                    message.tool.name,
                    message.arguments,
                );
                await this.configuration.communicator.emit("tool:call", {
                    agent,
                    toolCallId: message.id,
                    tool: message.tool.name,
                    args: message.arguments,
                });
            }
        }

        if (!toolCallsPending) {
            await this.notifyObservers("onTurnEnd", agent);
            await this.configuration.communicator.emit("agent:complete", {
                agent,
            });
        }
    }

    // Handle tool call execution
    async handleToolCall(
        agent: Agent,
        toolCallId: string,
        toolName: string,
        args: Record<string, any>,
    ): Promise<void> {
        const { session, tools } = await this.createAgentSession(agent);
        const tool = tools.find((t) => t.name === toolName);

        if (!tool) {
            const errorResult = { error: `Tool ${toolName} not found.` };
            await this.notifyObservers(
                "onToolCallEnd",
                agent,
                toolCallId,
                toolName,
                errorResult,
            );
            await this.configuration.communicator.emit("tool:complete", {
                agent,
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
                agent,
                toolCallId,
                tool.name,
                errorResult,
            );
            await this.configuration.communicator.emit("tool:complete", {
                agent,
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
                agent,
                toolCallId,
                tool.name,
                output,
            );
            await this.configuration.communicator.emit("tool:complete", {
                agent,
                toolCallId,
                tool: tool.name,
                result: output,
            });
        } catch (err: any) {
            const errorResult = { error: err?.message ?? String(err) };
            await this.notifyObservers(
                "onToolCallEnd",
                agent,
                toolCallId,
                tool.name,
                errorResult,
                err,
            );
            await this.configuration.communicator.emit("tool:complete", {
                agent,
                toolCallId,
                tool: tool.name,
                result: errorResult,
            });
        }
    }

    // Handle tool response and potentially resume agent
    async handleToolResponse(
        agent: Agent,
        toolName: string,
        toolCallId: string,
        result: any,
    ): Promise<void> {
        const { tools } = await this.createAgentSession(agent);
        const matchingTool = tools.find((t) => t.name === toolName);

        const toolRef: Tool = matchingTool ?? {
            name: toolName,
            description: "",
            inputSchema: { type: "object", description: "", properties: {} },
            execute: async () => { },
        };

        await this.configuration.memoryManager.addTranscriptEntries(agent, [
            {
                type: "tool_response",
                result,
                tool: toolRef,
                id: toolCallId,
            },
        ]);

        const memory =
            await this.configuration.memoryManager.getAgentMemory(agent);

        if (memory.getPendingToolCalls().length === 0) {
            await this.configuration.communicator.emit("agent:run", {
                agent,
            });
        }
    }

    // Get agent by id
    async getAgent(id: string): Promise<Agent | undefined> {
        return await this.configuration.memoryManager.getAgent(id);
    }

    async getAllAgents(): Promise<Agent[]> {
        return await this.configuration.memoryManager.getAllAgents()
    }

}
