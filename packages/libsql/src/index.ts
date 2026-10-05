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
import { type Client, createClient } from "@libsql/client";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { type LibSQLDatabase, drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";
import {
    byoaiAgentMemories,
    byoaiComputerSessions,
    byoaiTranscripts,
    byoaiUserTokens,
} from "./schema";

export * from "./schema";

export interface LibSqlPersistenceProperties {
    url?: string;
    URL?: string;
    authToken?: string;
    AUTH_TOKEN?: string;
    token?: string;
    path?: string;
    [key: string]: any;
}

function resolveLibSqlConfig(props?: LibSqlPersistenceProperties): {
    url: string;
    authToken?: string;
} {
    let url =
        props?.url ??
        props?.URL ??
        process.env.LIBSQL_URL ??
        process.env.TURSO_DATABASE_URL;

    if (!url && props?.path) {
        url = props.path === ":memory:" ? ":memory:" : `file:${props.path}`;
    }

    if (!url) {
        url = ":memory:";
    }

    const authToken =
        props?.authToken ??
        props?.AUTH_TOKEN ??
        props?.token ??
        process.env.LIBSQL_AUTH_TOKEN ??
        process.env.TURSO_AUTH_TOKEN;

    return { url, authToken: authToken || undefined };
}

function createLibSqlClient(props?: LibSqlPersistenceProperties): Client {
    const config = resolveLibSqlConfig(props);
    return createClient(config);
}

async function runSchemaDDL(client: Client): Promise<void> {
    await client.execute("PRAGMA foreign_keys = ON;");
    await client.execute(`
        CREATE TABLE IF NOT EXISTS byoai_agent_memories (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            user_id TEXT NOT NULL,
            mode TEXT NOT NULL,
            parent_id TEXT,
            computer_id TEXT,
            skills_path TEXT,
            created_at INTEGER
        );
    `);

    await client.execute(`
        CREATE TABLE IF NOT EXISTS byoai_transcripts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            agent_id TEXT NOT NULL REFERENCES byoai_agent_memories(id) ON DELETE CASCADE,
            entry TEXT NOT NULL,
            created_at INTEGER
        );
    `);

    await client.execute(`
        CREATE INDEX IF NOT EXISTS idx_libsql_byoai_transcripts_agent_id ON byoai_transcripts(agent_id);
    `);

    await client.execute(`
        CREATE TABLE IF NOT EXISTS byoai_user_tokens (
            user_id TEXT PRIMARY KEY,
            access_token TEXT,
            token_type TEXT,
            expires_at INTEGER,
            extra_headers TEXT,
            updated_at INTEGER
        );
    `);

    await client.execute(`
        CREATE TABLE IF NOT EXISTS byoai_computer_sessions (
            key TEXT PRIMARY KEY,
            computer_id TEXT NOT NULL,
            lifecycle TEXT NOT NULL,
            skills_path TEXT,
            created_at INTEGER
        );
    `);
}

/**
 * LibSQL / Turso Drizzle-powered implementation of AgentMemoryManager.
 */
export class LibSqlAgentMemoryManager implements AgentMemoryManager {
    public readonly client: Client;
    public readonly db: LibSQLDatabase<typeof schema>;
    private initPromise: Promise<void> | null = null;

    constructor(
        props?:
            | LibSqlPersistenceProperties
            | Client
            | LibSQLDatabase<typeof schema>
            | any,
    ) {
        if (props && "select" in props && typeof props.select === "function") {
            this.db = props;
            this.client = (props as any).session?.client;
        } else if (props && ("execute" in props || "batch" in props)) {
            this.client = props;
            this.db = drizzle(this.client, { schema });
        } else {
            this.client = createLibSqlClient(props);
            this.db = drizzle(this.client, { schema });
        }
    }

    async init(): Promise<void> {
        if (!this.initPromise) {
            this.initPromise = runSchemaDDL(this.client);
        }
        await this.initPromise;
    }

    async createAgentMemoryEntry(
        name: string,
        userId: string,
        mode: InteractiveMode = "interactive",
        parentId?: string,
    ): Promise<string> {
        await this.init();
        const id = randomUUID();
        await this.db.insert(byoaiAgentMemories).values({
            id,
            name,
            userId,
            mode,
            parentId: parentId ?? null,
            createdAt: Date.now(),
        });
        return id;
    }

    async getAgentMemory(agentId: string): Promise<AgentMemory> {
        await this.init();
        const [meta] = await this.db
            .select()
            .from(byoaiAgentMemories)
            .where(eq(byoaiAgentMemories.id, agentId));

        if (!meta) {
            throw new Error(`Agent ${agentId} not found`);
        }

        const transcriptRows = await this.db
            .select({ entry: byoaiTranscripts.entry })
            .from(byoaiTranscripts)
            .where(eq(byoaiTranscripts.agentId, agentId))
            .orderBy(asc(byoaiTranscripts.id));

        const transcript: ModelInteraction[] = transcriptRows.map(
            (r) => r.entry as ModelInteraction,
        );

        return new AgentMemory(
            meta.name,
            meta.userId,
            transcript,
            meta.computerId ?? undefined,
            meta.skillsPath ?? undefined,
            meta.mode as InteractiveMode,
            meta.parentId ?? undefined,
        );
    }

    async addTranscriptEntries(
        agentId: string,
        conversationEntries: ModelInteraction[],
    ): Promise<void> {
        if (conversationEntries.length === 0) return;
        await this.init();

        for (const entry of conversationEntries) {
            await this.db.insert(byoaiTranscripts).values({
                agentId,
                entry: entry as any,
                createdAt: Date.now(),
            });
        }
    }

    async setComputerId(agentId: string, computerId: string): Promise<void> {
        await this.init();
        await this.db
            .update(byoaiAgentMemories)
            .set({ computerId })
            .where(eq(byoaiAgentMemories.id, agentId));
    }

    async setSkillsPath(agentId: string, skillsPath: string): Promise<void> {
        await this.init();
        await this.db
            .update(byoaiAgentMemories)
            .set({ skillsPath })
            .where(eq(byoaiAgentMemories.id, agentId));
    }

    async setName(agentId: string, name: string): Promise<void> {
        await this.init();
        await this.db
            .update(byoaiAgentMemories)
            .set({ name })
            .where(eq(byoaiAgentMemories.id, agentId));
    }

    async getAgent(id: string): Promise<AgentHandle | undefined> {
        await this.init();
        const [row] = await this.db
            .select()
            .from(byoaiAgentMemories)
            .where(eq(byoaiAgentMemories.id, id));

        if (!row) return undefined;
        return {
            id: row.id,
            name: row.name,
            userId: row.userId,
            computerId: row.computerId ?? undefined,
            parentId: row.parentId ?? undefined,
        };
    }

    async getAgentByUser(
        id: string,
        userId: string,
    ): Promise<AgentHandle | undefined> {
        await this.init();
        const [row] = await this.db
            .select()
            .from(byoaiAgentMemories)
            .where(
                and(
                    eq(byoaiAgentMemories.id, id),
                    eq(byoaiAgentMemories.userId, userId),
                ),
            );

        if (!row) return undefined;
        return {
            id: row.id,
            name: row.name,
            userId: row.userId,
            computerId: row.computerId ?? undefined,
            parentId: row.parentId ?? undefined,
        };
    }

    async getAllAgents(): Promise<string[]> {
        await this.init();
        const rows = await this.db
            .select({ id: byoaiAgentMemories.id })
            .from(byoaiAgentMemories)
            .orderBy(desc(byoaiAgentMemories.createdAt));

        return rows.map((r) => r.id);
    }

    async getAllAgentsByUser(userId: string): Promise<string[]> {
        await this.init();
        const rows = await this.db
            .select({ id: byoaiAgentMemories.id })
            .from(byoaiAgentMemories)
            .where(eq(byoaiAgentMemories.userId, userId))
            .orderBy(desc(byoaiAgentMemories.createdAt));

        return rows.map((r) => r.id);
    }

    async getSubAgents(parentId: string): Promise<string[]> {
        await this.init();
        const rows = await this.db
            .select({ id: byoaiAgentMemories.id })
            .from(byoaiAgentMemories)
            .where(eq(byoaiAgentMemories.parentId, parentId))
            .orderBy(desc(byoaiAgentMemories.createdAt));

        return rows.map((r) => r.id);
    }

    async destroy(): Promise<void> {
        if (this.client && typeof this.client.close === "function") {
            this.client.close();
        }
    }
}

/**
 * LibSQL / Turso Drizzle-powered implementation of UserTokenManager.
 */
export class LibSqlUserTokenManager implements UserTokenManager {
    public readonly client: Client;
    public readonly db: LibSQLDatabase<typeof schema>;
    private initPromise: Promise<void> | null = null;

    constructor(
        props?:
            | LibSqlPersistenceProperties
            | Client
            | LibSQLDatabase<typeof schema>
            | any,
    ) {
        if (props && "select" in props && typeof props.select === "function") {
            this.db = props;
            this.client = (props as any).session?.client;
        } else if (props && ("execute" in props || "batch" in props)) {
            this.client = props;
            this.db = drizzle(this.client, { schema });
        } else {
            this.client = createLibSqlClient(props);
            this.db = drizzle(this.client, { schema });
        }
    }

    async init(): Promise<void> {
        if (!this.initPromise) {
            this.initPromise = runSchemaDDL(this.client);
        }
        await this.initPromise;
    }

    private getExpirationMs(expiresAt?: number): number | undefined {
        if (expiresAt === undefined) return undefined;
        return expiresAt < 1e11 ? expiresAt * 1000 : expiresAt;
    }

    async getUserToken(userId: string): Promise<AuthContext | undefined> {
        await this.init();
        const [row] = await this.db
            .select()
            .from(byoaiUserTokens)
            .where(eq(byoaiUserTokens.userId, userId));

        if (!row) return undefined;

        const expMs = this.getExpirationMs(row.expiresAt ?? undefined);
        if (expMs !== undefined && Date.now() >= expMs) {
            await this.clearUserToken(userId);
            return undefined;
        }

        return {
            accessToken: row.accessToken ?? undefined,
            tokenType: row.tokenType ?? undefined,
            expiresAt: row.expiresAt ?? undefined,
            extraHeaders: (row.extraHeaders as Record<string, string>) ?? undefined,
        };
    }

    async setUserToken(userId: string, authContext: AuthContext): Promise<void> {
        await this.init();
        const expMs = this.getExpirationMs(authContext.expiresAt);
        if (expMs !== undefined && Date.now() >= expMs) {
            await this.clearUserToken(userId);
            return;
        }

        await this.db
            .insert(byoaiUserTokens)
            .values({
                userId,
                accessToken: authContext.accessToken ?? null,
                tokenType: authContext.tokenType ?? null,
                expiresAt: authContext.expiresAt ?? null,
                extraHeaders: authContext.extraHeaders ?? null,
                updatedAt: Date.now(),
            })
            .onConflictDoUpdate({
                target: byoaiUserTokens.userId,
                set: {
                    accessToken: authContext.accessToken ?? null,
                    tokenType: authContext.tokenType ?? null,
                    expiresAt: authContext.expiresAt ?? null,
                    extraHeaders: authContext.extraHeaders ?? null,
                    updatedAt: Date.now(),
                },
            });
    }

    async clearUserToken(userId: string): Promise<void> {
        await this.init();
        await this.db
            .delete(byoaiUserTokens)
            .where(eq(byoaiUserTokens.userId, userId));
    }

    async destroy(): Promise<void> {
        if (this.client && typeof this.client.close === "function") {
            this.client.close();
        }
    }
}

/**
 * LibSQL / Turso Drizzle-powered implementation of ComputerLifecycleManager.
 */
export class LibSqlComputerLifecycleManager implements ComputerLifecycleManager {
    public readonly client: Client;
    public readonly db: LibSQLDatabase<typeof schema>;
    private initPromise: Promise<void> | null = null;

    constructor(
        props?:
            | LibSqlPersistenceProperties
            | Client
            | LibSQLDatabase<typeof schema>
            | any,
    ) {
        if (props && "select" in props && typeof props.select === "function") {
            this.db = props;
            this.client = (props as any).session?.client;
        } else if (props && ("execute" in props || "batch" in props)) {
            this.client = props;
            this.db = drizzle(this.client, { schema });
        } else {
            this.client = createLibSqlClient(props);
            this.db = drizzle(this.client, { schema });
        }
    }

    async init(): Promise<void> {
        if (!this.initPromise) {
            this.initPromise = runSchemaDDL(this.client);
        }
        await this.initPromise;
    }

    async getComputer(
        scope: ComputerLifecycleScope,
    ): Promise<ComputerSessionRecord | undefined> {
        await this.init();
        const key = getComputerLifecycleStorageKey(scope);
        const [row] = await this.db
            .select()
            .from(byoaiComputerSessions)
            .where(eq(byoaiComputerSessions.key, key));

        if (!row) return undefined;
        return {
            computerId: row.computerId,
            lifecycle: row.lifecycle as any,
            skillsPath: row.skillsPath ?? undefined,
            createdAt: row.createdAt ?? undefined,
        };
    }

    async setComputer(
        scope: ComputerLifecycleScope,
        record: ComputerSessionRecord,
    ): Promise<void> {
        await this.init();
        const key = getComputerLifecycleStorageKey(scope);
        await this.db
            .insert(byoaiComputerSessions)
            .values({
                key,
                computerId: record.computerId,
                lifecycle: record.lifecycle,
                skillsPath: record.skillsPath ?? null,
                createdAt: record.createdAt ?? Date.now(),
            })
            .onConflictDoUpdate({
                target: byoaiComputerSessions.key,
                set: {
                    computerId: record.computerId,
                    lifecycle: record.lifecycle,
                    skillsPath: record.skillsPath ?? null,
                    createdAt: record.createdAt ?? Date.now(),
                },
            });
    }

    async removeComputer(scope: ComputerLifecycleScope): Promise<void> {
        await this.init();
        const key = getComputerLifecycleStorageKey(scope);
        await this.db
            .delete(byoaiComputerSessions)
            .where(eq(byoaiComputerSessions.key, key));
    }

    async clear(): Promise<void> {
        await this.init();
        await this.db.delete(byoaiComputerSessions);
    }

    async destroy(): Promise<void> {
        if (this.client && typeof this.client.close === "function") {
            this.client.close();
        }
    }
}

// Named exports for all 3 managers
export {
    LibSqlAgentMemoryManager as AgentMemoryManager,
    LibSqlAgentMemoryManager as ChatMemory,
    LibSqlUserTokenManager as UserTokenManager,
    LibSqlUserTokenManager as TokenStore,
    LibSqlComputerLifecycleManager as ComputerLifecycleManager,
    LibSqlComputerLifecycleManager as ComputerStore,
};

// Factory functions
export function createAgentMemoryManager(
    props?: LibSqlPersistenceProperties,
): LibSqlAgentMemoryManager {
    return new LibSqlAgentMemoryManager(props);
}

export function createChatMemory(
    props?: LibSqlPersistenceProperties,
): LibSqlAgentMemoryManager {
    return new LibSqlAgentMemoryManager(props);
}

export function createTokenStore(
    props?: LibSqlPersistenceProperties,
): LibSqlUserTokenManager {
    return new LibSqlUserTokenManager(props);
}

export function createUserTokenManager(
    props?: LibSqlPersistenceProperties,
): LibSqlUserTokenManager {
    return new LibSqlUserTokenManager(props);
}

export function createComputerStore(
    props?: LibSqlPersistenceProperties,
): LibSqlComputerLifecycleManager {
    return new LibSqlComputerLifecycleManager(props);
}

export function createComputerLifecycleManager(
    props?: LibSqlPersistenceProperties,
): LibSqlComputerLifecycleManager {
    return new LibSqlComputerLifecycleManager(props);
}

// Default export
export default LibSqlAgentMemoryManager;
