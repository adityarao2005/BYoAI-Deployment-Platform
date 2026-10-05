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
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg, { type PoolConfig } from "pg";
import * as schema from "./schema";
import {
    byoaiAgentMemories,
    byoaiComputerSessions,
    byoaiTranscripts,
    byoaiUserTokens,
} from "./schema";

const { Pool } = pg;

export * from "./schema";

export interface PostgresPersistenceProperties {
    url?: string;
    URL?: string;
    connectionString?: string;
    host?: string;
    HOST?: string;
    port?: string | number;
    PORT?: string | number;
    user?: string;
    USER?: string;
    password?: string;
    PASSWORD?: string;
    database?: string;
    DATABASE?: string;
    ssl?: boolean | any;
    max?: number;
    [key: string]: any;
}

function createPool(props?: PostgresPersistenceProperties): pg.Pool {
    const connStr = props?.url ?? props?.URL ?? props?.connectionString;
    if (connStr) {
        return new Pool({ connectionString: connStr });
    }

    const config: PoolConfig = {
        host: props?.host ?? props?.HOST ?? "localhost",
        port:
            typeof props?.port === "string"
                ? Number.parseInt(props.port, 10)
                : (props?.port ?? 5432),
        user: props?.user ?? props?.USER ?? "postgres",
        password: props?.password ?? props?.PASSWORD ?? "postgres",
        database: props?.database ?? props?.DATABASE ?? "postgres",
        max: props?.max ?? 10,
    };

    if (props?.ssl !== undefined) {
        config.ssl = props.ssl;
    }

    return new Pool(config);
}

async function runSchemaDDL(db: NodePgDatabase<typeof schema>): Promise<void> {
    await db.execute(sql`
        CREATE TABLE IF NOT EXISTS byoai_agent_memories (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            user_id TEXT NOT NULL,
            mode TEXT NOT NULL,
            parent_id TEXT,
            computer_id TEXT,
            skills_path TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS byoai_transcripts (
            id SERIAL PRIMARY KEY,
            agent_id TEXT NOT NULL REFERENCES byoai_agent_memories(id) ON DELETE CASCADE,
            entry JSONB NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_byoai_transcripts_agent_id ON byoai_transcripts(agent_id);

        CREATE TABLE IF NOT EXISTS byoai_user_tokens (
            user_id TEXT PRIMARY KEY,
            access_token TEXT,
            token_type TEXT,
            expires_at BIGINT,
            extra_headers JSONB,
            updated_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS byoai_computer_sessions (
            key TEXT PRIMARY KEY,
            computer_id TEXT NOT NULL,
            lifecycle TEXT NOT NULL,
            skills_path TEXT,
            created_at BIGINT
        );
    `);
}

/**
 * PostgreSQL Drizzle-powered implementation of AgentMemoryManager.
 */
export class PostgresAgentMemoryManager implements AgentMemoryManager {
    public readonly pool: pg.Pool;
    public readonly db: NodePgDatabase<typeof schema>;
    private initPromise: Promise<void> | null = null;

    constructor(
        props?:
            | PostgresPersistenceProperties
            | pg.Pool
            | NodePgDatabase<typeof schema>
            | any,
    ) {
        if (props && "select" in props && typeof props.select === "function") {
            this.db = props;
            this.pool = (props as any).$client ?? (props as any).session?.client;
        } else if (props && ("query" in props || props instanceof Pool)) {
            this.pool = props;
            this.db = drizzle(this.pool, { schema });
        } else {
            this.pool = createPool(props);
            this.db = drizzle(this.pool, { schema });
        }
    }

    async init(): Promise<void> {
        if (!this.initPromise) {
            this.initPromise = runSchemaDDL(this.db);
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

        await this.db.insert(byoaiTranscripts).values(
            conversationEntries.map((entry) => ({
                agentId,
                entry,
            })),
        );
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
        if (this.pool && typeof this.pool.end === "function") {
            await this.pool.end();
        }
    }
}

/**
 * PostgreSQL Drizzle-powered implementation of UserTokenManager.
 */
export class PostgresUserTokenManager implements UserTokenManager {
    public readonly pool: pg.Pool;
    public readonly db: NodePgDatabase<typeof schema>;
    private initPromise: Promise<void> | null = null;

    constructor(
        props?:
            | PostgresPersistenceProperties
            | pg.Pool
            | NodePgDatabase<typeof schema>
            | any,
    ) {
        if (props && "select" in props && typeof props.select === "function") {
            this.db = props;
            this.pool = (props as any).$client ?? (props as any).session?.client;
        } else if (props && ("query" in props || props instanceof Pool)) {
            this.pool = props;
            this.db = drizzle(this.pool, { schema });
        } else {
            this.pool = createPool(props);
            this.db = drizzle(this.pool, { schema });
        }
    }

    async init(): Promise<void> {
        if (!this.initPromise) {
            this.initPromise = runSchemaDDL(this.db);
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

        const expiresAtNum = row.expiresAt ? Number(row.expiresAt) : undefined;
        const expMs = this.getExpirationMs(expiresAtNum);
        if (expMs !== undefined && Date.now() >= expMs) {
            await this.clearUserToken(userId);
            return undefined;
        }

        return {
            accessToken: row.accessToken ?? undefined,
            tokenType: row.tokenType ?? undefined,
            expiresAt: expiresAtNum,
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
                updatedAt: sql`NOW()`,
            })
            .onConflictDoUpdate({
                target: byoaiUserTokens.userId,
                set: {
                    accessToken: authContext.accessToken ?? null,
                    tokenType: authContext.tokenType ?? null,
                    expiresAt: authContext.expiresAt ?? null,
                    extraHeaders: authContext.extraHeaders ?? null,
                    updatedAt: sql`NOW()`,
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
        if (this.pool && typeof this.pool.end === "function") {
            await this.pool.end();
        }
    }
}

/**
 * PostgreSQL Drizzle-powered implementation of ComputerLifecycleManager.
 */
export class PostgresComputerLifecycleManager implements ComputerLifecycleManager {
    public readonly pool: pg.Pool;
    public readonly db: NodePgDatabase<typeof schema>;
    private initPromise: Promise<void> | null = null;

    constructor(
        props?:
            | PostgresPersistenceProperties
            | pg.Pool
            | NodePgDatabase<typeof schema>
            | any,
    ) {
        if (props && "select" in props && typeof props.select === "function") {
            this.db = props;
            this.pool = (props as any).$client ?? (props as any).session?.client;
        } else if (props && ("query" in props || props instanceof Pool)) {
            this.pool = props;
            this.db = drizzle(this.pool, { schema });
        } else {
            this.pool = createPool(props);
            this.db = drizzle(this.pool, { schema });
        }
    }

    async init(): Promise<void> {
        if (!this.initPromise) {
            this.initPromise = runSchemaDDL(this.db);
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
            createdAt: row.createdAt ? Number(row.createdAt) : undefined,
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
        if (this.pool && typeof this.pool.end === "function") {
            await this.pool.end();
        }
    }
}

// Named exports for all 3 managers
export {
    PostgresAgentMemoryManager as AgentMemoryManager,
    PostgresAgentMemoryManager as ChatMemory,
    PostgresUserTokenManager as UserTokenManager,
    PostgresUserTokenManager as TokenStore,
    PostgresComputerLifecycleManager as ComputerLifecycleManager,
    PostgresComputerLifecycleManager as ComputerStore,
};

// Factory functions
export function createAgentMemoryManager(
    props?: PostgresPersistenceProperties,
): PostgresAgentMemoryManager {
    return new PostgresAgentMemoryManager(props);
}

export function createChatMemory(
    props?: PostgresPersistenceProperties,
): PostgresAgentMemoryManager {
    return new PostgresAgentMemoryManager(props);
}

export function createTokenStore(
    props?: PostgresPersistenceProperties,
): PostgresUserTokenManager {
    return new PostgresUserTokenManager(props);
}

export function createUserTokenManager(
    props?: PostgresPersistenceProperties,
): PostgresUserTokenManager {
    return new PostgresUserTokenManager(props);
}

export function createComputerStore(
    props?: PostgresPersistenceProperties,
): PostgresComputerLifecycleManager {
    return new PostgresComputerLifecycleManager(props);
}

export function createComputerLifecycleManager(
    props?: PostgresPersistenceProperties,
): PostgresComputerLifecycleManager {
    return new PostgresComputerLifecycleManager(props);
}

// Default export
export default PostgresAgentMemoryManager;
