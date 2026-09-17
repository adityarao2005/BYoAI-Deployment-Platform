import {
    type AgentHandle,
    AgentMemory,
    type AgentMemoryManager,
} from "@/agents";
import type { ModelInteraction } from "@/models/conversation";

/**
 * In-memory implementation of {@link AgentMemoryManager} for managing non-persistent agent conversation state.
 */
export class InMemoryAgentMemoryManager implements AgentMemoryManager {
    private memories: Map<string, AgentMemory> = new Map();
    private counter = 0;

    async createAgentMemoryEntry(name: string): Promise<string> {
        const id = `agent-${++this.counter}`;
        this.memories.set(id, new AgentMemory(name));
        return id;
    }

    async setName(agentId: string, name: string): Promise<void> {
        const memory = this.memories.get(agentId);

        if (memory) {
            memory.name = name;
        }
    }

    async getAgentMemory(agentId: string): Promise<AgentMemory> {
        const memory = this.memories.get(agentId);
        if (!memory) {
            throw new Error(`Agent ${agentId} not found`);
        }
        return memory;
    }

    async addTranscriptEntries(
        agentId: string,
        conversationEntries: ModelInteraction[],
    ): Promise<void> {
        const memory = await this.getAgentMemory(agentId);
        memory.transcript.push(...conversationEntries);
    }

    async setComputerId(agentId: string, computerId: string): Promise<void> {
        const memory = await this.getAgentMemory(agentId);
        memory.computerId = computerId;
    }

    async getAgent(id: string): Promise<AgentHandle | undefined> {
        const memory = this.memories.get(id);

        if (!memory) return undefined;

        return {
            id,
            name: memory.name,
            computerId: memory.computerId,
        };
    }

    async getAllAgents(): Promise<string[]> {
        return Array.from(this.memories.keys());
    }
}
