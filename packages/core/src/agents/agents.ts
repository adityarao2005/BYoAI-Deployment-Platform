import path from "node:path";
import type {
    ModelInteraction,
    ModelMessageOutput,
} from "@/models/conversation";
import type { Model } from "@/models/models";
import { exportSkillRepositoryToZip, type Skill, type SkillRepository } from "@/skills";
import type { ComputerProvider } from "@/tools";
import { validateToolArgument } from "@/tools/tool_argument";
import type { Tool, ToolProvider } from "@/tools/tools";
import { AgentMemory, type AgentMemoryManager } from "./agent.memory";

export { AgentMemory, type AgentMemoryManager };

import type { AgentCommunicator } from "./agent.messaging";
import type { AgentObserver } from "./agent.observer";
import type { AuthContext, UserTokenManager } from "./agent.auth";
import { AgentExecutionError } from "@/errors/exceptions";
/**
 * Plain agent identifier.
 */
export type AgentHandle = {
    id: string;
    name: string;
    computerId?: string;
    userId: string;
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
    readonly userTokenManager: UserTokenManager;
};

/**
 * Constructs the system prompt string from agent metadata and available skills.
 */
export function constructSystemPrompt(
    name: string,
    description: string,
    mode: InteractiveMode,
    skills: Skill[],
    skillsPath?: string,
): string {
    const formattedSkills = skills
        .map((skill) => {
            const locationTag = skillsPath
                ? `\n            <location>${path.posix.join(skillsPath, skill.frontMatter.name)}</location>`
                : "";
            return `
        <skill>
            <name>${skill.frontMatter.name}</name>
            <description><![CDATA[${skill.frontMatter.description}]]></description>${locationTag}
        </skill>`.trim();
        })
        .join("\n");

    const skillsDirSection = skillsPath
        ? `\n## Skills Directory:\n\nYour skills and asset files are located on the computer at: ${skillsPath}\n`
        : "";

    return `
## Who you are:

You are an AI Agent named ${name}.

## Your purpose:

${description}
${skillsDirSection}

${mode === "non-interactive" ? "Note: You are being run in non-interactive mode, this means the user has asked you to complete some task and be done, do not ask a follow up question or request for any user input." : ""}

## Your skills:

<available_skills>
    ${formattedSkills}
</available_skills>
    `.trim();
}

export type InteractiveMode = "interactive" | "non-interactive";

export interface CreateAgentProps {
    userId: string;
    mode?: InteractiveMode;
}

/**
 * Execution session context provided to tools when executed by an agent.
 */
export interface AgentSession {
    readonly agent: AgentHandle;
    readonly name: string;
    readonly userId: string;
    readonly description: string;
    readonly memory: AgentMemory;
    readonly computerProvider?: ComputerProvider;
    readonly skillRepositories?: SkillRepository[];
    readonly authContext?: AuthContext;
    readonly mode: InteractiveMode;
}

import { AgentExecutor, type IAgentExecutor } from "./agent.executor";

export { AgentExecutor, type IAgentExecutor };

/**
 * Interface for agent lifecycle management (creation, listing, transcript queries).
 */
export interface IAgentLifecycleManager {
    createAgent(props: CreateAgentProps | string): Promise<AgentHandle>;
    getAgentInteraction(id: string): Promise<AgentInteraction | undefined>;
    getAgentInteractionByUser(
        id: string,
        userId: string,
    ): Promise<AgentInteraction | undefined>;
    getAllAgents(): Promise<string[]>;
    getAllAgentsByUser(userId: string): Promise<string[]>;
}

/**
 * Manager class orchestrating agent initialization, event subscription, and execution lifecycle.
 */
export class AgentManager implements IAgentLifecycleManager {
    private configuration: AgentConfiguration;
    private executor: AgentExecutor;
    private unsubscribers: Array<() => void> = [];

    constructor(configuration: AgentConfiguration, executor?: AgentExecutor) {
        this.configuration = configuration;
        this.executor = executor ?? new AgentExecutor(configuration);
    }

    async init(): Promise<void> {
        await this.executor.init();

        // Subscribe to communicator events to drive agent execution
        const comm = this.configuration.communicator;

        this.unsubscribers.push(
            comm.on("agent:run", async ({ agentId }) => {
                try {
                    await this.executor.runTurn(agentId);
                } catch (error) {
                    await this.executor.notifyError(
                        agentId,
                        error,
                        "agent:run",
                    );
                    await this.configuration.communicator.emit(
                        "agent:complete",
                        {
                            agentId,
                        },
                    );
                }
            }),
        );

        this.unsubscribers.push(
            comm.on("user:message", async ({ agentId, content }) => {
                try {
                    await this.executor.sendMessage(agentId, content);
                } catch (error) {
                    await this.executor.notifyError(
                        agentId,
                        error,
                        "user:message",
                    );
                    await this.configuration.communicator.emit(
                        "agent:complete",
                        {
                            agentId,
                        },
                    );
                }
            }),
        );

        this.unsubscribers.push(
            comm.on(
                "tool:call",
                async ({ agentId, toolCallId, tool, args }) => {
                    try {
                        await this.executor.handleToolCall(
                            agentId,
                            toolCallId,
                            tool,
                            args,
                        );
                    } catch (error) {
                        await this.executor.notifyError(
                            agentId,
                            error,
                            "tool:call",
                        );
                    }
                },
            ),
        );

        this.unsubscribers.push(
            comm.on(
                "tool:complete",
                async ({ agentId, toolCallId, tool, result }) => {
                    try {
                        await this.executor.handleToolResponse(
                            agentId,
                            tool,
                            toolCallId,
                            result,
                        );
                    } catch (error) {
                        await this.executor.notifyError(
                            agentId,
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
    async createAgent(props: CreateAgentProps | string): Promise<AgentHandle> {
        const userId = typeof props === "string" ? props : props.userId;
        const mode =
            typeof props === "object" && props.mode ? props.mode : "interactive";
        const id =
            await this.configuration.memoryManager.createAgentMemoryEntry(
                this.configuration.name,
                userId,
                mode,
            );

        if (this.configuration.computerProvider) {
            // TODO: handle lifecycle differences
            const computerId =
                await this.configuration.computerProvider.createComputer();
            if (computerId) {
                await this.configuration.memoryManager.setComputerId(
                    id,
                    computerId,
                );

                if (this.configuration.computerProvider.sendSkillsZip) {
                    for (const repo of this.configuration.skillRepository) {
                        try {
                            const zipBuffer = await exportSkillRepositoryToZip(repo);
                            const skillsPath = await this.configuration.computerProvider.sendSkillsZip(
                                computerId,
                                zipBuffer,
                            );
                            await this.configuration.memoryManager.setSkillsPath(
                                id,
                                skillsPath,
                            );
                        } catch {
                            // Ignore failure to send skills zip if repo export is unavailable
                        }
                    }
                }
            }
        }

        const value = await this.configuration.memoryManager.getAgent(id);

        if (!value) {
            throw new AgentExecutionError(
                `Something went wrong when attempting to create the agent: ${id}`,
                { agentId: id },
            );
        }
        return value;
    }

    // Creates an agent session which will be used by the tools
    async createAgentSession(agentId: string): Promise<{
        session: AgentSession;
        tools: Tool[];
    }> {
        return this.executor.createAgentSession(agentId);
    }

    // Send message to agent
    async sendMessageToAgent(agentId: string, message: string): Promise<void> {
        return this.executor.sendMessage(agentId, message);
    }

    // Run agent execution cycle
    async runAgent(agentId: string): Promise<void> {
        return this.executor.runTurn(agentId);
    }

    // Handle tool call execution
    async handleToolCall(
        agentId: string,
        toolCallId: string,
        toolName: string,
        args: Record<string, any>,
    ): Promise<void> {
        return this.executor.handleToolCall(
            agentId,
            toolCallId,
            toolName,
            args,
        );
    }

    // Handle tool response and potentially resume agent
    async handleToolResponse(
        agentId: string,
        toolName: string,
        toolCallId: string,
        result: any,
    ): Promise<void> {
        return this.executor.handleToolResponse(
            agentId,
            toolName,
            toolCallId,
            result,
        );
    }

    // Get agent by id
    async getAgentInteraction(
        id: string,
    ): Promise<AgentInteraction | undefined> {
        const agent = await this.configuration.memoryManager.getAgent(id);
        if (!agent) {
            return undefined;
        }

        const memory =
            await this.configuration.memoryManager.getAgentMemory(id);

        return {
            id,
            userId: agent.userId,
            name: memory.name,
            transcript: memory.transcript,
            mode: memory.mode,
        };
    }

    // Get agent by id
    async getAgentInteractionByUser(
        id: string,
        userId: string,
    ): Promise<AgentInteraction | undefined> {
        const agent = await this.configuration.memoryManager.getAgentByUser(
            id,
            userId,
        );
        if (!agent) {
            return undefined;
        }

        const memory =
            await this.configuration.memoryManager.getAgentMemory(id);

        return {
            id,
            userId: agent.userId,
            name: memory.name,
            transcript: memory.transcript,
            mode: memory.mode,
        };
    }

    async getAllAgents(): Promise<string[]> {
        return await this.configuration.memoryManager.getAllAgents();
    }

    async getAllAgentsByUser(userId: string): Promise<string[]> {
        return await this.configuration.memoryManager.getAllAgentsByUser(
            userId,
        );
    }

    get communicator(): AgentCommunicator {
        return this.configuration.communicator;
    }

    get memoryManager(): AgentMemoryManager {
        return this.configuration.memoryManager;
    }

    get userTokenManager(): UserTokenManager {
        return this.configuration.userTokenManager;
    }
}

export type AgentInteraction = {
    id: string;
    name: string;
    userId: string;
    transcript: ModelInteraction[];
    mode: InteractiveMode;
};
