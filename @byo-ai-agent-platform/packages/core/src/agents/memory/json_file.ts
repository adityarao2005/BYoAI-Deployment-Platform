import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
    type AgentHandle,
    AgentMemory,
    type AgentMemoryManager,
} from "@/agents";
import type { ModelInteraction } from "@/models/conversation";

/**
 * Serialized JSON record schema for persisting agent memory to disk.
 */
export interface JsonAgentMemoryRecord {
    id: string;
    computerId?: string;
    transcript: ModelInteraction[];
    name: string;
    userId: string;
}

/**
 * File-backed implementation of {@link AgentMemoryManager} persisting agent memories as JSON files on disk.
 */
export class JsonFileAgentMemoryManager implements AgentMemoryManager {
    private storageDir: string;
    private initialized = false;

    constructor(storageDir?: string) {
        this.storageDir =
            storageDir ?? path.resolve(process.cwd(), ".agent_memory");
    }

    private async ensureStorageDir(): Promise<void> {
        if (!this.initialized) {
            await fs.mkdir(this.storageDir, { recursive: true });
            this.initialized = true;
        }
    }

    private getFilePath(agentId: string): string {
        // Sanitize agentId to avoid directory traversal
        const safeId = path.basename(agentId);
        return path.join(this.storageDir, `${safeId}.json`);
    }

    private async readRecord(agentId: string): Promise<JsonAgentMemoryRecord> {
        await this.ensureStorageDir();
        const filePath = this.getFilePath(agentId);
        try {
            const data = await fs.readFile(filePath, "utf-8");
            return JSON.parse(data) as JsonAgentMemoryRecord;
        } catch {
            throw new Error(`Agent ${agentId} not found`);
        }
    }

    private async writeRecord(record: JsonAgentMemoryRecord): Promise<void> {
        await this.ensureStorageDir();
        const filePath = this.getFilePath(record.id);
        const tempPath = `${filePath}.${crypto.randomUUID()}.tmp`;
        await fs.writeFile(tempPath, JSON.stringify(record, null, 2), "utf-8");
        await fs.rename(tempPath, filePath);
    }

    async createAgentMemoryEntry(name: string, userId: string): Promise<string> {
        await this.ensureStorageDir();
        const id = `agent-${crypto.randomUUID()}`;
        const initialRecord: JsonAgentMemoryRecord = {
            id,
            name,
            transcript: [],
            userId
        };
        await this.writeRecord(initialRecord);
        return id;
    }

    async getAgentMemory(agentId: string): Promise<AgentMemory> {
        const record = await this.readRecord(agentId);
        return new AgentMemory(
            record.name,
            record.userId,
            record.transcript ?? [],
            record.computerId,
        );
    }

    async setName(agentId: string, name: string): Promise<void> {
        const record = await this.readRecord(agentId);
        record.name = name;
        await this.writeRecord(record);
    }

    async getAgent(id: string): Promise<AgentHandle | undefined> {
        try {
            const record = await this.readRecord(id);

            return {
                id: record.id,
                userId: record.userId,
                computerId: record.computerId,
                name: record.name,
            };
        } catch {
            return undefined;
        }
    }

    async getAgentByUser(id: string, userId: string): Promise<AgentHandle | undefined> {
        const agent = await this.getAgent(id)

        if (agent?.userId === userId) {
            return agent
        }

        return undefined
    }

    async getAllAgents(): Promise<string[]> {
        await this.ensureStorageDir();
        try {
            const files = await fs.readdir(this.storageDir);
            return files
                .filter((file) => file.endsWith(".json"))
                .map((file) => file.replace(/\.json$/, ""));
        } catch {
            return [];
        }
    }

    async getAllAgentsByUser(userId: string): Promise<string[]> {
        const agents = await this.getAllAgents()

        const result = []
        for (const agent of agents) {
            const value = await this.getAgent(agent)
            if (value?.userId === userId)
                result.push(agent)
        }

        return result
    }

    async addTranscriptEntries(
        agentId: string,
        conversationEntries: ModelInteraction[],
    ): Promise<void> {
        const record = await this.readRecord(agentId);
        record.transcript.push(...conversationEntries);
        await this.writeRecord(record);
    }

    async setComputerId(agentId: string, computerId: string): Promise<void> {
        const record = await this.readRecord(agentId);
        record.computerId = computerId;
        await this.writeRecord(record);
    }
}
