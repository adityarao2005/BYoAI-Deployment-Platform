import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { AgentMemory, type Agent, type AgentMemoryManager } from "../agents";
import type { ModelInteraction } from "@/models/conversation";

export interface JsonAgentMemoryRecord {
    id: string;
    computerId?: string;
    transcript: ModelInteraction[];
}

export class JsonFileAgentMemoryManager implements AgentMemoryManager {
    private storageDir: string;
    private initialized = false;

    constructor(storageDir?: string) {
        this.storageDir = storageDir ?? path.resolve(process.cwd(), ".agent_memory");
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
            return {
                id: agentId,
                transcript: [],
            };
        }
    }

    private async writeRecord(record: JsonAgentMemoryRecord): Promise<void> {
        await this.ensureStorageDir();
        const filePath = this.getFilePath(record.id);
        const tempPath = `${filePath}.${crypto.randomUUID()}.tmp`;
        await fs.writeFile(tempPath, JSON.stringify(record, null, 2), "utf-8");
        await fs.rename(tempPath, filePath);
    }

    async createAgentMemoryEntry(): Promise<string> {
        await this.ensureStorageDir();
        const id = `agent-${crypto.randomUUID()}`;
        const initialRecord: JsonAgentMemoryRecord = {
            id,
            transcript: [],
        };
        await this.writeRecord(initialRecord);
        return id;
    }

    async getAgentMemory(agent: Agent): Promise<AgentMemory> {
        const record = await this.readRecord(agent.id);
        return new AgentMemory(record.transcript ?? [], record.computerId);
    }

    async addTranscriptEntries(agent: Agent, conversationEntries: ModelInteraction[]): Promise<void> {
        const record = await this.readRecord(agent.id);
        record.transcript.push(...conversationEntries);
        await this.writeRecord(record);
    }

    async setComputerId(agent: Agent, computerId: string): Promise<void> {
        const record = await this.readRecord(agent.id);
        record.computerId = computerId;
        await this.writeRecord(record);
    }
}
