import { randomUUID } from "node:crypto";
import {
    AgentMemory,
    type AgentHandle,
    type AgentMemoryManager,
    type AuthContext,
    type ComputerLifecycleManager,
    type ComputerLifecycleScope,
    type ComputerSessionRecord,
    type InteractiveMode,
    type UserTokenManager,
    getComputerLifecycleStorageKey,
} from "@byo-ai-agent-platform/core/agents";
import type { ModelInteraction } from "@byo-ai-agent-platform/core/models";
import { Redis, type RedisOptions } from "ioredis";

export interface RedisPersistenceProperties {
    url?: string;
    URL?: string;
    host?: string;
    HOST?: string;
    port?: string | number;
    PORT?: string | number;
    password?: string;
    PASSWORD?: string;
    db?: string | number;
    DB?: string | number;
    keyPrefix?: string;
    KEY_PREFIX?: string;
    [key: string]: any;
}

function createRedisClient(props?: RedisPersistenceProperties): Redis {
    const rawUrl = props?.url ?? props?.URL;
    if (rawUrl) {
        return new Redis(rawUrl, {
            lazyConnect: true,
            maxRetriesPerRequest: 3,
        });
    }

    const host = props?.host ?? props?.HOST ?? "127.0.0.1";
    const rawPort = props?.port ?? props?.PORT ?? 6379;
    const port = typeof rawPort === "string" ? Number.parseInt(rawPort, 10) : rawPort;
    const password = props?.password ?? props?.PASSWORD;
    const rawDb = props?.db ?? props?.DB ?? 0;
    const db = typeof rawDb === "string" ? Number.parseInt(rawDb, 10) : rawDb;

    const options: RedisOptions = {
        host,
        port,
        db,
        lazyConnect: true,
        maxRetriesPerRequest: 3,
    };

    if (password) {
        options.password = password;
    }

    return new Redis(options);
}

/**
 * Redis-backed implementation of UserTokenManager with native Redis TTL expiration.
 */
export class RedisUserTokenManager implements UserTokenManager {
    public readonly client: Redis;
    private readonly prefix: string;

    constructor(props?: RedisPersistenceProperties) {
        this.client = createRedisClient(props);
        this.prefix = props?.keyPrefix ?? props?.KEY_PREFIX ?? "byoai:token:";
    }

    async init(): Promise<void> {
        if (this.client.status === "wait") {
            await this.client.connect();
        }
    }

    private getKey(userId: string): string {
        return `${this.prefix}${userId}`;
    }

    private getExpirationMs(expiresAt?: number): number | undefined {
        if (expiresAt === undefined) return undefined;
        return expiresAt < 1e11 ? expiresAt * 1000 : expiresAt;
    }

    async getUserToken(userId: string): Promise<AuthContext | undefined> {
        const key = this.getKey(userId);
        const data = await this.client.get(key);
        if (!data) return undefined;

        try {
            const token = JSON.parse(data) as AuthContext;
            const expMs = this.getExpirationMs(token.expiresAt);
            if (expMs !== undefined && Date.now() >= expMs) {
                await this.clearUserToken(userId);
                return undefined;
            }
            return token;
        } catch {
            return undefined;
        }
    }

    async setUserToken(userId: string, authContext: AuthContext): Promise<void> {
        const key = this.getKey(userId);
        const expMs = this.getExpirationMs(authContext.expiresAt);
        const data = JSON.stringify(authContext);

        if (expMs !== undefined) {
            const ttlSeconds = Math.floor((expMs - Date.now()) / 1000);
            if (ttlSeconds <= 0) {
                await this.clearUserToken(userId);
                return;
            }
            await this.client.set(key, data, "EX", ttlSeconds);
        } else {
            await this.client.set(key, data);
        }
    }

    async clearUserToken(userId: string): Promise<void> {
        const key = this.getKey(userId);
        await this.client.del(key);
    }

    async destroy(): Promise<void> {
        await this.client.quit();
    }
}

/**
 * Redis-backed implementation of ComputerLifecycleManager.
 */
export class RedisComputerLifecycleManager implements ComputerLifecycleManager {
    public readonly client: Redis;
    private readonly prefix: string;

    constructor(props?: RedisPersistenceProperties) {
        this.client = createRedisClient(props);
        this.prefix = props?.keyPrefix ?? props?.KEY_PREFIX ?? "byoai:comp:";
    }

    async init(): Promise<void> {
        if (this.client.status === "wait") {
            await this.client.connect();
        }
    }

    private getKey(scope: ComputerLifecycleScope): string {
        const storageKey = getComputerLifecycleStorageKey(scope);
        return `${this.prefix}${storageKey}`;
    }

    async getComputer(
        scope: ComputerLifecycleScope,
    ): Promise<ComputerSessionRecord | undefined> {
        const key = this.getKey(scope);
        const data = await this.client.get(key);
        if (!data) return undefined;

        try {
            return JSON.parse(data) as ComputerSessionRecord;
        } catch {
            return undefined;
        }
    }

    async setComputer(
        scope: ComputerLifecycleScope,
        record: ComputerSessionRecord,
    ): Promise<void> {
        const key = this.getKey(scope);
        await this.client.set(key, JSON.stringify(record));
    }

    async removeComputer(scope: ComputerLifecycleScope): Promise<void> {
        const key = this.getKey(scope);
        await this.client.del(key);
    }

    async clear(): Promise<void> {
        let cursor = "0";
        const pattern = `${this.prefix}*`;
        do {
            const [nextCursor, keys] = await this.client.scan(
                cursor,
                "MATCH",
                pattern,
                "COUNT",
                100,
            );
            cursor = nextCursor;
            if (keys.length > 0) {
                await this.client.del(...keys);
            }
        } while (cursor !== "0");
    }

    async destroy(): Promise<void> {
        await this.client.quit();
    }
}

interface RedisAgentMeta {
    id: string;
    name: string;
    userId: string;
    mode: InteractiveMode;
    parentId?: string;
    computerId?: string;
    skillsPath?: string;
}

/**
 * Redis-backed implementation of AgentMemoryManager.
 */
export class RedisAgentMemoryManager implements AgentMemoryManager {
    public readonly client: Redis;
    private readonly prefix: string;

    constructor(props?: RedisPersistenceProperties) {
        this.client = createRedisClient(props);
        this.prefix = props?.keyPrefix ?? props?.KEY_PREFIX ?? "byoai:agent:";
    }

    async init(): Promise<void> {
        if (this.client.status === "wait") {
            await this.client.connect();
        }
    }

    private metaKey(agentId: string): string {
        return `${this.prefix}${agentId}:meta`;
    }

    private transcriptKey(agentId: string): string {
        return `${this.prefix}${agentId}:transcript`;
    }

    async createAgentMemoryEntry(
        name: string,
        userId: string,
        mode: InteractiveMode = "interactive",
        parentId?: string,
    ): Promise<string> {
        const id = randomUUID();
        const meta: RedisAgentMeta = {
            id,
            name,
            userId,
            mode,
            parentId,
        };

        await this.client.set(this.metaKey(id), JSON.stringify(meta));
        await this.client.sadd(`${this.prefix}all`, id);
        await this.client.sadd(`${this.prefix}user:${userId}`, id);
        if (parentId) {
            await this.client.sadd(`${this.prefix}sub:${parentId}`, id);
        }

        return id;
    }

    async getAgentMemory(agentId: string): Promise<AgentMemory> {
        const metaStr = await this.client.get(this.metaKey(agentId));
        if (!metaStr) {
            throw new Error(`Agent ${agentId} not found`);
        }
        const meta = JSON.parse(metaStr) as RedisAgentMeta;

        const transcriptItems = await this.client.lrange(
            this.transcriptKey(agentId),
            0,
            -1,
        );
        const transcript: ModelInteraction[] = transcriptItems.map((item) =>
            JSON.parse(item),
        );

        return new AgentMemory(
            meta.name,
            meta.userId,
            transcript,
            meta.computerId,
            meta.skillsPath,
            meta.mode,
            meta.parentId,
        );
    }

    async addTranscriptEntries(
        agentId: string,
        conversationEntries: ModelInteraction[],
    ): Promise<void> {
        if (conversationEntries.length === 0) return;
        const serialized = conversationEntries.map((e) => JSON.stringify(e));
        await this.client.rpush(this.transcriptKey(agentId), ...serialized);
    }

    async setComputerId(agentId: string, computerId: string): Promise<void> {
        const metaStr = await this.client.get(this.metaKey(agentId));
        if (!metaStr) throw new Error(`Agent ${agentId} not found`);
        const meta = JSON.parse(metaStr) as RedisAgentMeta;
        meta.computerId = computerId;
        await this.client.set(this.metaKey(agentId), JSON.stringify(meta));
    }

    async setSkillsPath(agentId: string, skillsPath: string): Promise<void> {
        const metaStr = await this.client.get(this.metaKey(agentId));
        if (!metaStr) throw new Error(`Agent ${agentId} not found`);
        const meta = JSON.parse(metaStr) as RedisAgentMeta;
        meta.skillsPath = skillsPath;
        await this.client.set(this.metaKey(agentId), JSON.stringify(meta));
    }

    async setName(agentId: string, name: string): Promise<void> {
        const metaStr = await this.client.get(this.metaKey(agentId));
        if (!metaStr) throw new Error(`Agent ${agentId} not found`);
        const meta = JSON.parse(metaStr) as RedisAgentMeta;
        meta.name = name;
        await this.client.set(this.metaKey(agentId), JSON.stringify(meta));
    }

    async getAgent(id: string): Promise<AgentHandle | undefined> {
        const metaStr = await this.client.get(this.metaKey(id));
        if (!metaStr) return undefined;
        const meta = JSON.parse(metaStr) as RedisAgentMeta;
        return {
            id: meta.id,
            name: meta.name,
            userId: meta.userId,
            computerId: meta.computerId,
            parentId: meta.parentId,
        };
    }

    async getAgentByUser(
        id: string,
        userId: string,
    ): Promise<AgentHandle | undefined> {
        const agent = await this.getAgent(id);
        if (agent && agent.userId === userId) {
            return agent;
        }
        return undefined;
    }

    async getAllAgents(): Promise<string[]> {
        return await this.client.smembers(`${this.prefix}all`);
    }

    async getAllAgentsByUser(userId: string): Promise<string[]> {
        return await this.client.smembers(`${this.prefix}user:${userId}`);
    }

    async getSubAgents(parentId: string): Promise<string[]> {
        return await this.client.smembers(`${this.prefix}sub:${parentId}`);
    }

    async destroy(): Promise<void> {
        await this.client.quit();
    }
}

// Named exports for all 3 managers
export {
    RedisAgentMemoryManager as AgentMemoryManager,
    RedisAgentMemoryManager as ChatMemory,
    RedisUserTokenManager as UserTokenManager,
    RedisUserTokenManager as TokenStore,
    RedisComputerLifecycleManager as ComputerLifecycleManager,
    RedisComputerLifecycleManager as ComputerStore,
};

// Factory functions
export function createAgentMemoryManager(
    props?: RedisPersistenceProperties,
): RedisAgentMemoryManager {
    return new RedisAgentMemoryManager(props);
}

export function createChatMemory(
    props?: RedisPersistenceProperties,
): RedisAgentMemoryManager {
    return new RedisAgentMemoryManager(props);
}

export function createTokenStore(
    props?: RedisPersistenceProperties,
): RedisUserTokenManager {
    return new RedisUserTokenManager(props);
}

export function createUserTokenManager(
    props?: RedisPersistenceProperties,
): RedisUserTokenManager {
    return new RedisUserTokenManager(props);
}

export function createComputerStore(
    props?: RedisPersistenceProperties,
): RedisComputerLifecycleManager {
    return new RedisComputerLifecycleManager(props);
}

export function createComputerLifecycleManager(
    props?: RedisPersistenceProperties,
): RedisComputerLifecycleManager {
    return new RedisComputerLifecycleManager(props);
}

// Default export
export default RedisAgentMemoryManager;
