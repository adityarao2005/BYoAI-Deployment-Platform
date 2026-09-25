import type { ModelInteraction } from "@/models";
import type { AgentHandle, InteractiveMode } from "./agents";

/**
 * Encapsulates agent state, including conversation transcript, associated computer provider ID, and pending tool calls.
 */
export class AgentMemory {
    transcript: ModelInteraction[];
    computerId?: string;
    skillsPath?: string;
    name: string;
    userId: string;
    mode: InteractiveMode;

    constructor(
        name: string,
        userId: string,
        transcript: ModelInteraction[] = [],
        computerId?: string,
        skillsPath?: string,
        mode: InteractiveMode = "interactive",
    ) {
        this.transcript = transcript;
        this.computerId = computerId;
        this.skillsPath = skillsPath;
        this.name = name;
        this.userId = userId;
        this.mode = mode;
    }

    /**
     * Computes tool call IDs that have been invoked but not yet answered with a tool response.
     */
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

/**
 * Interface for managing agent conversation memory, transcripts, and computer provider session state.
 */
export interface AgentMemoryManager {
    /** Creates a new memory entry for an agent and returns its memory ID */
    createAgentMemoryEntry(
        name: string,
        userId: string,
        mode?: InteractiveMode,
    ): Promise<string>;

    /** Retrieves memory for a given agent */
    getAgentMemory(agentId: string): Promise<AgentMemory>;

    /** Appends conversation items to the agent transcript */
    addTranscriptEntries(
        agentId: string,
        conversationEntries: ModelInteraction[],
    ): Promise<void>;

    /** Sets the active computer provider session ID for the agent */
    setComputerId(agentId: string, computerId: string): Promise<void>;

    /** Sets the root skills directory path on the computer for the agent */
    setSkillsPath(agentId: string, skillsPath: string): Promise<void>;

    /** Sets the name of the agent */
    setName(agentId: string, name: string): Promise<void>;

    // Get agent by id
    getAgent(id: string): Promise<AgentHandle | undefined>;
    
    // Get agent by id
    getAgentByUser(id: string, userId: string): Promise<AgentHandle | undefined>;

    // get all agents
    getAllAgents(): Promise<string[]>;

    // get all agents by user
    getAllAgentsByUser(userId: string): Promise<string[]>
}
