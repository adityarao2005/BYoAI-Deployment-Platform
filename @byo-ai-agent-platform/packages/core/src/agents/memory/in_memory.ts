import { AgentMemory, type Agent, type AgentMemoryManager } from "../agents";
import type { ModelInteraction } from "@/models/conversation";

export class InMemoryAgentMemoryManager implements AgentMemoryManager {
    private memories: Map<string, AgentMemory> = new Map();
    private counter = 0;

    async createAgentMemoryEntry(): Promise<string> {
        const id = `agent-${++this.counter}`;
        this.memories.set(id, new AgentMemory());
        return id;
    }

    async getAgentMemory(agent: Agent): Promise<AgentMemory> {
        let memory = this.memories.get(agent.id);
        if (!memory) {
            memory = new AgentMemory();
            this.memories.set(agent.id, memory);
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
}
