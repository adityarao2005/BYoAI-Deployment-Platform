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
import type { ComputerLifecycle } from "@/config/tool_config";
import type {
    ComputerLifecycleManager,
    ComputerLifecycleScope,
} from "./agent.computer_lifecycle";
import {
    type MemoryManager,
    normalizeMemoryManager,
} from "./agent.unified_memory";

export { type MemoryManager };

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
    readonly memoryManager: MemoryManager | AgentMemoryManager;
    readonly communicator: AgentCommunicator;
    readonly computerProvider?: ComputerProvider;
    readonly computerLifecycleManager?: ComputerLifecycleManager;
    readonly observers?: AgentObserver[];
    readonly userTokenManager?: UserTokenManager;
    readonly rules?: string[];
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
    rules: string[] = [],
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

    const rulesSection =
        rules && rules.length > 0
            ? `\n## Rules & Compliance:\n\nYou MUST adhere to the following rules at all times:\n${rules.map((rule, idx) => `${idx + 1}. ${rule}`).join("\n")}\n`
            : "";

    return `
## Who you are:

You are an AI Agent named ${name}.

## Your purpose:

${description}
${skillsDirSection}${rulesSection}
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
    readonly rules?: string[];
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
    private memory: MemoryManager;
    private executor: AgentExecutor;
    private unsubscribers: Array<() => void> = [];

    constructor(configuration: AgentConfiguration, executor?: AgentExecutor) {
        this.configuration = configuration;
        this.memory = normalizeMemoryManager(configuration.memoryManager, {
            userTokenManager: configuration.userTokenManager,
            computerLifecycleManager: configuration.computerLifecycleManager,
        });
        this.executor =
            executor ?? new AgentExecutor(configuration, this.memory);
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
                    const errorMessage =
                        error instanceof Error ? error.message : String(error);
                    await this.executor.notifyError(
                        agentId,
                        error,
                        "agent:run",
                    );
                    await this.configuration.communicator.emit("agent:error", {
                        agentId,
                        error: errorMessage,
                        context: "agent:run",
                    });
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
                    const errorMessage =
                        error instanceof Error ? error.message : String(error);
                    await this.executor.notifyError(
                        agentId,
                        error,
                        "user:message",
                    );
                    await this.configuration.communicator.emit("agent:error", {
                        agentId,
                        error: errorMessage,
                        context: "user:message",
                    });
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

        const handleAccept = async ({
            agentId,
            toolCallId,
        }: { agentId: string; toolCallId: string }) => {
            try {
                await this.executor.acceptToolCall(agentId, toolCallId);
            } catch (error) {
                await this.executor.notifyError(
                    agentId,
                    error,
                    "tool:accept",
                );
            }
        };

        const handleReject = async ({
            agentId,
            toolCallId,
            reason,
        }: { agentId: string; toolCallId: string; reason?: string }) => {
            try {
                await this.executor.rejectToolCall(
                    agentId,
                    toolCallId,
                    reason,
                );
            } catch (error) {
                await this.executor.notifyError(
                    agentId,
                    error,
                    "tool:reject",
                );
            }
        };

        this.unsubscribers.push(comm.on("tool:accept", handleAccept));
        this.unsubscribers.push(comm.on("tool:reject", handleReject));
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
            await this.memory.agent.createAgentMemoryEntry(
                this.configuration.name,
                userId,
                mode,
            );

        if (this.configuration.computerProvider) {
            const lifecycle: ComputerLifecycle =
                this.configuration.computerProvider.lifecycle ?? "user";

            const scope: ComputerLifecycleScope = {
                lifecycle,
                agentName: this.configuration.name,
                userId,
                interactionId: id,
            };

            const existing =
                await this.memory.computerLifecycle.getComputer(scope);

            let computerId = existing?.computerId;
            let skillsPath = existing?.skillsPath;

            if (!computerId) {
                computerId =
                    await this.configuration.computerProvider.createComputer();
                if (computerId) {
                    if (this.configuration.computerProvider.sendSkillsZip) {
                        for (const repo of this.configuration.skillRepository) {
                            try {
                                const zipBuffer =
                                    await exportSkillRepositoryToZip(repo);
                                skillsPath =
                                    await this.configuration.computerProvider.sendSkillsZip(
                                        computerId,
                                        zipBuffer,
                                    );
                            } catch {
                                // Ignore failure to send skills zip if repo export is unavailable
                            }
                        }
                    }

                    await this.memory.computerLifecycle.setComputer(scope, {
                        computerId,
                        skillsPath,
                        lifecycle,
                        createdAt: Date.now(),
                    });
                }
            }

            if (computerId) {
                await this.memory.agent.setComputerId(
                    id,
                    computerId,
                );

                if (skillsPath) {
                    await this.memory.agent.setSkillsPath(
                        id,
                        skillsPath,
                    );
                }
            }
        }

        const value = await this.memory.agent.getAgent(id);

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

    // Accept tool call
    async acceptToolCall(
        agentId: string,
        toolCallId: string,
    ): Promise<void> {
        return this.executor.acceptToolCall(agentId, toolCallId);
    }

    // Reject tool call
    async rejectToolCall(
        agentId: string,
        toolCallId: string,
        reason?: string,
    ): Promise<void> {
        return this.executor.rejectToolCall(agentId, toolCallId, reason);
    }

    // Get agent by id
    async getAgentInteraction(
        id: string,
    ): Promise<AgentInteraction | undefined> {
        const agent = await this.memory.agent.getAgent(id);
        if (!agent) {
            return undefined;
        }

        const memory =
            await this.memory.agent.getAgentMemory(id);

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
        const agent = await this.memory.agent.getAgentByUser(
            id,
            userId,
        );
        if (!agent) {
            return undefined;
        }

        const memory =
            await this.memory.agent.getAgentMemory(id);

        return {
            id,
            userId: agent.userId,
            name: memory.name,
            transcript: memory.transcript,
            mode: memory.mode,
        };
    }

    async getAllAgents(): Promise<string[]> {
        return await this.memory.agent.getAllAgents();
    }

    async getAllAgentsByUser(userId: string): Promise<string[]> {
        return await this.memory.agent.getAllAgentsByUser(
            userId,
        );
    }

    get communicator(): AgentCommunicator {
        return this.configuration.communicator;
    }

    get memoryManager(): MemoryManager {
        return this.memory;
    }

    get agentMemory(): AgentMemoryManager {
        return this.memory.agent;
    }

    get userTokenManager(): UserTokenManager {
        return this.memory.userToken;
    }

    get computerLifecycleManager(): ComputerLifecycleManager {
        return this.memory.computerLifecycle;
    }
}

export type AgentInteraction = {
    id: string;
    name: string;
    userId: string;
    transcript: ModelInteraction[];
    mode: InteractiveMode;
};
