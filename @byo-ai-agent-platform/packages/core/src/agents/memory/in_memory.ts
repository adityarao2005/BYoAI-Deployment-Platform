import { AgentMemory, type Agent, type AgentMemoryManager } from "../agents";
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

    async setName(agent: Agent, name: string): Promise<void> {
        const memory = this.memories.get(agent.id)

        if (memory) {
            memory.name = name
        }
    }

    async getAgentMemory(agent: Agent): Promise<AgentMemory> {
        const memory = this.memories.get(agent.id);
        if (!memory) {
            throw new Error(`Agent ${agent.id} not found`)
        }
        return memory;
    }

    async addTranscriptEntries(agent: Agent, conversationEntries: ModelInteraction[]): Promise<void> {
        const memory = await this.getAgentMemory(agent);
        memory.transcript.push(...conversationEntries);
    }

    async setComputerId(agent: Agent, computerId: string): Promise<void> {
        const memory = await this.getAgentMemory(agent);
        memory.computerId = computerId;
    }

    async getAgent(id: string): Promise<Agent | undefined> {
        const memory = this.memories.get(id)

        if (!memory)
            return undefined

        return {
            id,
            name: memory.name,
            computerId: memory.computerId
        }
    }

    async getAllAgents(): Promise<Agent[]> {
        return this.memories.entries().map(([id, agent]) => {
            return {
                id,
                name: agent.name,
                computerId: agent.computerId
            }
        }).toArray()
    }
}
