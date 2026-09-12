import type {
    ModelInteraction,
    ModelMessageOutput,
} from "@/models/conversation";
import type { Model } from "@/models/models";
import type { Skill, SkillRepository } from "@/skills";
import type { ComputerProvider } from "@/tools";
import { validateToolArgument } from "@/tools/tool_argument";
import type { Tool, ToolProvider } from "@/tools/tools";

// Plain agent identifier
export type Agent = {
    id: string;
    name?: string;
    computerId?: string;
};

// Memory of agent (computer, transcript of conversation, and pending tool calls)
export class AgentMemory {
    transcript: ModelInteraction[];
    computerId?: string;

    constructor(transcript: ModelInteraction[] = [], computerId?: string) {
        this.transcript = transcript;
        this.computerId = computerId;
    }

    getPendingToolCalls(): string[] {
        const pending = new Set<string>();

        for (const interaction of this.transcript) {
            if (interaction.type === "tool_call") {
                pending.add(interaction.id);
            } else if (interaction.type === "tool_response") {
                pending.delete(interaction.id);
            }
        }

        return Array.from(pending);
    }
}

// Memory manager interface
export interface AgentMemoryManager {
    // create memory entry of agent
    createAgentMemoryEntry(): Promise<string>;
    // grab agent memory
    getAgentMemory(agent: Agent): Promise<AgentMemory>;
    // add conversation item
    addTranscriptEntries(
        agent: Agent,
        conversationEntries: ModelInteraction[],
    ): Promise<void>;
    // sets the computer id for the agent
    setComputerId(agent: Agent, computerId: string): Promise<void>;
}

// Strongly-typed event map for agent communication
export type AgentEventMap = {
    "user:message": { agent: Agent; content: string };
    "agent:message": { agent: Agent; content: string };
    "agent:run": { agent: Agent };
    "agent:complete": { agent: Agent };
    "tool:call": {
        agent: Agent;
        toolCallId: string;
        tool: string;
        args: Record<string, any>;
    };
    "tool:complete": {
        agent: Agent;
        toolCallId: string;
        tool: string;
        result: any;
    };
};

export type AgentEventHandler<T> = (payload: T) => Promise<void> | void;

// Communicator interface: event-driven asynchronous pub/sub
export interface AgentCommunicator {
    emit<K extends keyof AgentEventMap>(
        event: K,
        payload: AgentEventMap[K],
    ): Promise<void>;
    on<K extends keyof AgentEventMap>(
        event: K,
        handler: AgentEventHandler<AgentEventMap[K]>,
    ): () => void;
}

// Observer interface for monitoring agent execution lifecycle
export interface AgentObserver {
    onTurnStart?(agent: Agent, userMessage: string): Promise<void> | void;
    onTurnEnd?(agent: Agent, error?: unknown): Promise<void> | void;
    onModelStart?(agent: Agent, prompt: string): Promise<void> | void;
    onModelEnd?(
        agent: Agent,
        output: ModelMessageOutput[],
    ): Promise<void> | void;
    onAgentMessage?(agent: Agent, content: string): Promise<void> | void;
    onToolCallStart?(
        agent: Agent,
        toolCallId: string,
        tool: string,
        args: Record<string, any>,
    ): Promise<void> | void;
    onToolCallEnd?(
        agent: Agent,
        toolCallId: string,
        tool: string,
        result: any,
        error?: unknown,
    ): Promise<void> | void;
    onError?(
        agent: Agent,
        error: unknown,
        context?: string,
    ): Promise<void> | void;
}

// Configuration of the agent
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

// Construct system prompt from agent definition and loaded skills
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

// Session passed to tools during execution
export interface AgentSession {
    readonly agent: Agent;
    readonly name: string;
    readonly description: string;
    readonly memory: AgentMemory;
    readonly computerProvider?: ComputerProvider;
    readonly skillRepositories?: SkillRepository[];
}

// AgentManager orchestrating the agent lifecycle
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
            await this.configuration.memoryManager.createAgentMemoryEntry();
        let computerId: string | undefined;

        if (this.configuration.computerProvider) {
            // TODO: handle lifecycle differences
            computerId =
                await this.configuration.computerProvider.createComputer();
            if (computerId) {
                await this.configuration.memoryManager.setComputerId(
                    { id },
                    computerId,
                );
            }
        }

        const agent: Agent = {
            id,
            name: this.configuration.name,
            computerId,
        };

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
            execute: async () => {},
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
}
