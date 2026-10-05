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
import { type Db, MongoClient } from "mongodb";

export interface MongoPersistenceProperties {
    url?: string;
    URL?: string;
    uri?: string;
    URI?: string;
    database?: string;
    DATABASE?: string;
    db?: string;
    DB?: string;
    [key: string]: any;
}

function getDatabaseName(props?: MongoPersistenceProperties): string {
    return props?.database ?? props?.DATABASE ?? props?.db ?? props?.DB ?? "byoai";
}

function createClient(props?: MongoPersistenceProperties): {
    client: MongoClient;
    dbName: string;
} {
    const rawUrl =
        props?.url ??
        props?.URL ??
        props?.uri ??
        props?.URI ??
        "mongodb://localhost:27017";
    const dbName = getDatabaseName(props);
    const client = new MongoClient(rawUrl);
    return { client, dbName };
}

let mongoInitPromise: Promise<void> | null = null;

async function ensureMongoIndexes(db: Db): Promise<void> {
    if (!mongoInitPromise) {
        mongoInitPromise = (async () => {
            const agentsColl = db.collection("byoai_agents");
            await agentsColl.createIndex({ userId: 1 });
            await agentsColl.createIndex({ parentId: 1 });

            const tokensColl = db.collection("byoai_user_tokens");
            await tokensColl.createIndex({ userId: 1 }, { unique: true });

            const compColl = db.collection("byoai_computer_sessions");
            await compColl.createIndex({ key: 1 }, { unique: true });
        })();
    }
    await mongoInitPromise;
}

/**
 * MongoDB implementation of AgentMemoryManager.
 */
export class MongoAgentMemoryManager implements AgentMemoryManager {
    public readonly client: MongoClient;
    public readonly dbName: string;
    private connected = false;

    constructor(props?: MongoPersistenceProperties | { client: MongoClient; dbName: string }) {
        if (props && "client" in props) {
            this.client = props.client;
            this.dbName = props.dbName;
        } else {
            const res = createClient(props);
            this.client = res.client;
            this.dbName = res.dbName;
        }
    }

    async init(): Promise<void> {
        if (!this.connected) {
            await this.client.connect();
            this.connected = true;
        }
        await ensureMongoIndexes(this.client.db(this.dbName));
    }

    private get coll() {
        return this.client.db(this.dbName).collection("byoai_agents");
    }

    async createAgentMemoryEntry(
        name: string,
        userId: string,
        mode: InteractiveMode = "interactive",
        parentId?: string,
    ): Promise<string> {
        await this.init();
        const id = randomUUID();
        await this.coll.insertOne({
            _id: id as any,
            id,
            name,
            userId,
            mode,
            parentId: parentId ?? null,
            transcript: [],
            createdAt: new Date(),
        });
        return id;
    }

    async getAgentMemory(agentId: string): Promise<AgentMemory> {
        await this.init();
        const doc = await this.coll.findOne({ _id: agentId as any });
        if (!doc) {
            throw new Error(`Agent ${agentId} not found`);
        }

        return new AgentMemory(
            doc.name,
            doc.userId,
            doc.transcript ?? [],
            doc.computerId ?? undefined,
            doc.skillsPath ?? undefined,
            doc.mode as InteractiveMode,
            doc.parentId ?? undefined,
        );
    }

    async addTranscriptEntries(
        agentId: string,
        conversationEntries: ModelInteraction[],
    ): Promise<void> {
        if (conversationEntries.length === 0) return;
        await this.init();
        await this.coll.updateOne(
            { _id: agentId as any },
            { $push: { transcript: { $each: conversationEntries } } as any },
        );
    }

    async setComputerId(agentId: string, computerId: string): Promise<void> {
        await this.init();
        await this.coll.updateOne(
            { _id: agentId as any },
            { $set: { computerId } },
        );
    }

    async setSkillsPath(agentId: string, skillsPath: string): Promise<void> {
        await this.init();
        await this.coll.updateOne(
            { _id: agentId as any },
            { $set: { skillsPath } },
        );
    }

    async setName(agentId: string, name: string): Promise<void> {
        await this.init();
        await this.coll.updateOne({ _id: agentId as any }, { $set: { name } });
    }

    async getAgent(id: string): Promise<AgentHandle | undefined> {
        await this.init();
        const doc = await this.coll.findOne({ _id: id as any });
        if (!doc) return undefined;
        return {
            id: doc.id,
            name: doc.name,
            userId: doc.userId,
            computerId: doc.computerId ?? undefined,
            parentId: doc.parentId ?? undefined,
        };
    }

    async getAgentByUser(
        id: string,
        userId: string,
    ): Promise<AgentHandle | undefined> {
        await this.init();
        const doc = await this.coll.findOne({ _id: id as any, userId });
        if (!doc) return undefined;
        return {
            id: doc.id,
            name: doc.name,
            userId: doc.userId,
            computerId: doc.computerId ?? undefined,
            parentId: doc.parentId ?? undefined,
        };
    }

    async getAllAgents(): Promise<string[]> {
        await this.init();
        const docs = await this.coll.find({}, { projection: { id: 1 } }).toArray();
        return docs.map((d: any) => d.id ?? String(d._id));
    }

    async getAllAgentsByUser(userId: string): Promise<string[]> {
        await this.init();
        const docs = await this.coll
            .find({ userId }, { projection: { id: 1 } })
            .toArray();
        return docs.map((d: any) => d.id ?? String(d._id));
    }

    async getSubAgents(parentId: string): Promise<string[]> {
        await this.init();
        const docs = await this.coll
            .find({ parentId }, { projection: { id: 1 } })
            .toArray();
        return docs.map((d: any) => d.id ?? String(d._id));
    }

    async destroy(): Promise<void> {
        await this.client.close();
    }
}

/**
 * MongoDB implementation of UserTokenManager.
 */
export class MongoUserTokenManager implements UserTokenManager {
    public readonly client: MongoClient;
    public readonly dbName: string;
    private connected = false;

    constructor(props?: MongoPersistenceProperties | { client: MongoClient; dbName: string }) {
        if (props && "client" in props) {
            this.client = props.client;
            this.dbName = props.dbName;
        } else {
            const res = createClient(props);
            this.client = res.client;
            this.dbName = res.dbName;
        }
    }

    async init(): Promise<void> {
        if (!this.connected) {
            await this.client.connect();
            this.connected = true;
        }
        await ensureMongoIndexes(this.client.db(this.dbName));
    }

    private get coll() {
        return this.client.db(this.dbName).collection("byoai_user_tokens");
    }

    private getExpirationMs(expiresAt?: number): number | undefined {
        if (expiresAt === undefined) return undefined;
        return expiresAt < 1e11 ? expiresAt * 1000 : expiresAt;
    }

    async getUserToken(userId: string): Promise<AuthContext | undefined> {
        await this.init();
        const doc = await this.coll.findOne({ userId });
        if (!doc) return undefined;

        const expMs = this.getExpirationMs(doc.expiresAt);
        if (expMs !== undefined && Date.now() >= expMs) {
            await this.clearUserToken(userId);
            return undefined;
        }

        return {
            accessToken: doc.accessToken,
            tokenType: doc.tokenType,
            expiresAt: doc.expiresAt,
            extraHeaders: doc.extraHeaders,
        };
    }

    async setUserToken(userId: string, authContext: AuthContext): Promise<void> {
        await this.init();
        const expMs = this.getExpirationMs(authContext.expiresAt);
        if (expMs !== undefined && Date.now() >= expMs) {
            await this.clearUserToken(userId);
            return;
        }

        await this.coll.updateOne(
            { userId },
            {
                $set: {
                    userId,
                    accessToken: authContext.accessToken,
                    tokenType: authContext.tokenType,
                    expiresAt: authContext.expiresAt,
                    extraHeaders: authContext.extraHeaders,
                    updatedAt: new Date(),
                },
            },
            { upsert: true },
        );
    }

    async clearUserToken(userId: string): Promise<void> {
        await this.init();
        await this.coll.deleteOne({ userId });
    }

    async destroy(): Promise<void> {
        await this.client.close();
    }
}

/**
 * MongoDB implementation of ComputerLifecycleManager.
 */
export class MongoComputerLifecycleManager implements ComputerLifecycleManager {
    public readonly client: MongoClient;
    public readonly dbName: string;
    private connected = false;

    constructor(props?: MongoPersistenceProperties | { client: MongoClient; dbName: string }) {
        if (props && "client" in props) {
            this.client = props.client;
            this.dbName = props.dbName;
        } else {
            const res = createClient(props);
            this.client = res.client;
            this.dbName = res.dbName;
        }
    }

    async init(): Promise<void> {
        if (!this.connected) {
            await this.client.connect();
            this.connected = true;
        }
        await ensureMongoIndexes(this.client.db(this.dbName));
    }

    private get coll() {
        return this.client.db(this.dbName).collection("byoai_computer_sessions");
    }

    async getComputer(
        scope: ComputerLifecycleScope,
    ): Promise<ComputerSessionRecord | undefined> {
        await this.init();
        const key = getComputerLifecycleStorageKey(scope);
        const doc = await this.coll.findOne({ key });
        if (!doc) return undefined;

        return {
            computerId: doc.computerId,
            lifecycle: doc.lifecycle,
            skillsPath: doc.skillsPath ?? undefined,
            createdAt: doc.createdAt ?? undefined,
        };
    }

    async setComputer(
        scope: ComputerLifecycleScope,
        record: ComputerSessionRecord,
    ): Promise<void> {
        await this.init();
        const key = getComputerLifecycleStorageKey(scope);
        await this.coll.updateOne(
            { key },
            {
                $set: {
                    key,
                    computerId: record.computerId,
                    lifecycle: record.lifecycle,
                    skillsPath: record.skillsPath,
                    createdAt: record.createdAt ?? Date.now(),
                },
            },
            { upsert: true },
        );
    }

    async removeComputer(scope: ComputerLifecycleScope): Promise<void> {
        await this.init();
        const key = getComputerLifecycleStorageKey(scope);
        await this.coll.deleteOne({ key });
    }

    async clear(): Promise<void> {
        await this.init();
        await this.coll.deleteMany({});
    }

    async destroy(): Promise<void> {
        await this.client.close();
    }
}

// Named exports for all 3 managers
export {
    MongoAgentMemoryManager as AgentMemoryManager,
    MongoAgentMemoryManager as ChatMemory,
    MongoUserTokenManager as UserTokenManager,
    MongoUserTokenManager as TokenStore,
    MongoComputerLifecycleManager as ComputerLifecycleManager,
    MongoComputerLifecycleManager as ComputerStore,
};

// Factory functions
export function createAgentMemoryManager(
    props?: MongoPersistenceProperties,
): MongoAgentMemoryManager {
    return new MongoAgentMemoryManager(props);
}

export function createChatMemory(
    props?: MongoPersistenceProperties,
): MongoAgentMemoryManager {
    return new MongoAgentMemoryManager(props);
}

export function createTokenStore(
    props?: MongoPersistenceProperties,
): MongoUserTokenManager {
    return new MongoUserTokenManager(props);
}

export function createUserTokenManager(
    props?: MongoPersistenceProperties,
): MongoUserTokenManager {
    return new MongoUserTokenManager(props);
}

export function createComputerStore(
    props?: MongoPersistenceProperties,
): MongoComputerLifecycleManager {
    return new MongoComputerLifecycleManager(props);
}

export function createComputerLifecycleManager(
    props?: MongoPersistenceProperties,
): MongoComputerLifecycleManager {
    return new MongoComputerLifecycleManager(props);
}

// Default export
export default MongoAgentMemoryManager;
