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
import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import mysql, { type Pool, type PoolOptions } from "mysql2/promise";
import * as schema from "./schema";
import {
    byoaiAgentMemories,
    byoaiComputerSessions,
    byoaiTranscripts,
    byoaiUserTokens,
} from "./schema";

export * from "./schema";

export interface MySqlPersistenceProperties {
    url?: string;
    URL?: string;
    uri?: string;
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
    connectionLimit?: number;
    ssl?: any;
    [key: string]: any;
}

function createMySqlPool(props?: MySqlPersistenceProperties): Pool {
    const connUri = props?.url ?? props?.URL ?? props?.uri;
    if (connUri) {
        return mysql.createPool(connUri);
    }

    const opts: PoolOptions = {
        host: props?.host ?? props?.HOST ?? "localhost",
        port:
            typeof props?.port === "string"
                ? Number.parseInt(props.port, 10)
                : (props?.port ?? 3306),
        user: props?.user ?? props?.USER ?? "root",
        password: props?.password ?? props?.PASSWORD ?? "",
        database: props?.database ?? props?.DATABASE ?? "test",
        connectionLimit: props?.connectionLimit ?? 10,
    };

    if (props?.ssl !== undefined) {
        opts.ssl = props.ssl;
    }

    return mysql.createPool(opts);
}

async function runSchemaDDL(pool: Pool): Promise<void> {
    const conn = await pool.getConnection();
    try {
        await conn.query(`
            CREATE TABLE IF NOT EXISTS byoai_agent_memories (
                id VARCHAR(255) PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                user_id VARCHAR(255) NOT NULL,
                mode VARCHAR(64) NOT NULL,
                parent_id VARCHAR(255),
                computer_id VARCHAR(255),
                skills_path VARCHAR(1024),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await conn.query(`
            CREATE TABLE IF NOT EXISTS byoai_transcripts (
                id INT AUTO_INCREMENT PRIMARY KEY,
                agent_id VARCHAR(255) NOT NULL,
                entry JSON NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_mysql_byoai_transcripts_agent_id (agent_id)
            );
        `);

        await conn.query(`
            CREATE TABLE IF NOT EXISTS byoai_user_tokens (
                user_id VARCHAR(255) PRIMARY KEY,
                access_token TEXT,
                token_type VARCHAR(64),
                expires_at BIGINT,
                extra_headers JSON,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            );
        `);

        await conn.query(`
            CREATE TABLE IF NOT EXISTS byoai_computer_sessions (
                \`key\` VARCHAR(512) PRIMARY KEY,
                computer_id VARCHAR(255) NOT NULL,
                lifecycle VARCHAR(64) NOT NULL,
                skills_path VARCHAR(1024),
                created_at BIGINT
            );
        `);
    } finally {
        conn.release();
    }
}

/**
 * MySQL Drizzle-powered implementation of AgentMemoryManager.
 */
export class MySqlAgentMemoryManager implements AgentMemoryManager {
    public readonly pool: Pool;
    public readonly db: MySql2Database<typeof schema>;
    private initPromise: Promise<void> | null = null;

    constructor(
        props?:
            | MySqlPersistenceProperties
            | Pool
            | MySql2Database<typeof schema>
            | any,
    ) {
        if (props && "select" in props && typeof props.select === "function") {
            this.db = props;
            this.pool = (props as any).$client ?? (props as any).session?.client;
        } else if (props && ("query" in props || "getConnection" in props)) {
            this.pool = props;
            this.db = drizzle(this.pool, { schema, mode: "default" });
        } else {
            this.pool = createMySqlPool(props);
            this.db = drizzle(this.pool, { schema, mode: "default" });
        }
    }

    async init(): Promise<void> {
        if (!this.initPromise) {
            this.initPromise = runSchemaDDL(this.pool);
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

        for (const entry of conversationEntries) {
            await this.db.insert(byoaiTranscripts).values({
                agentId,
                entry: entry as any,
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
        if (this.pool && typeof this.pool.end === "function") {
            await this.pool.end();
        }
    }
}

/**
 * MySQL Drizzle-powered implementation of UserTokenManager.
 */
export class MySqlUserTokenManager implements UserTokenManager {
    public readonly pool: Pool;
    public readonly db: MySql2Database<typeof schema>;
    private initPromise: Promise<void> | null = null;

    constructor(
        props?:
            | MySqlPersistenceProperties
            | Pool
            | MySql2Database<typeof schema>
            | any,
    ) {
        if (props && "select" in props && typeof props.select === "function") {
            this.db = props;
            this.pool = (props as any).$client ?? (props as any).session?.client;
        } else if (props && ("query" in props || "getConnection" in props)) {
            this.pool = props;
            this.db = drizzle(this.pool, { schema, mode: "default" });
        } else {
            this.pool = createMySqlPool(props);
            this.db = drizzle(this.pool, { schema, mode: "default" });
        }
    }

    async init(): Promise<void> {
        if (!this.initPromise) {
            this.initPromise = runSchemaDDL(this.pool);
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
            })
            .onDuplicateKeyUpdate({
                set: {
                    accessToken: authContext.accessToken ?? null,
                    tokenType: authContext.tokenType ?? null,
                    expiresAt: authContext.expiresAt ?? null,
                    extraHeaders: authContext.extraHeaders ?? null,
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
 * MySQL Drizzle-powered implementation of ComputerLifecycleManager.
 */
export class MySqlComputerLifecycleManager implements ComputerLifecycleManager {
    public readonly pool: Pool;
    public readonly db: MySql2Database<typeof schema>;
    private initPromise: Promise<void> | null = null;

    constructor(
        props?:
            | MySqlPersistenceProperties
            | Pool
            | MySql2Database<typeof schema>
            | any,
    ) {
        if (props && "select" in props && typeof props.select === "function") {
            this.db = props;
            this.pool = (props as any).$client ?? (props as any).session?.client;
        } else if (props && ("query" in props || "getConnection" in props)) {
            this.pool = props;
            this.db = drizzle(this.pool, { schema, mode: "default" });
        } else {
            this.pool = createMySqlPool(props);
            this.db = drizzle(this.pool, { schema, mode: "default" });
        }
    }

    async init(): Promise<void> {
        if (!this.initPromise) {
            this.initPromise = runSchemaDDL(this.pool);
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
            .onDuplicateKeyUpdate({
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
    MySqlAgentMemoryManager as AgentMemoryManager,
    MySqlAgentMemoryManager as ChatMemory,
    MySqlUserTokenManager as UserTokenManager,
    MySqlUserTokenManager as TokenStore,
    MySqlComputerLifecycleManager as ComputerLifecycleManager,
    MySqlComputerLifecycleManager as ComputerStore,
};

// Factory functions
export function createAgentMemoryManager(
    props?: MySqlPersistenceProperties,
): MySqlAgentMemoryManager {
    return new MySqlAgentMemoryManager(props);
}

export function createChatMemory(
    props?: MySqlPersistenceProperties,
): MySqlAgentMemoryManager {
    return new MySqlAgentMemoryManager(props);
}

export function createTokenStore(
    props?: MySqlPersistenceProperties,
): MySqlUserTokenManager {
    return new MySqlUserTokenManager(props);
}

export function createUserTokenManager(
    props?: MySqlPersistenceProperties,
): MySqlUserTokenManager {
    return new MySqlUserTokenManager(props);
}

export function createComputerStore(
    props?: MySqlPersistenceProperties,
): MySqlComputerLifecycleManager {
    return new MySqlComputerLifecycleManager(props);
}

export function createComputerLifecycleManager(
    props?: MySqlPersistenceProperties,
): MySqlComputerLifecycleManager {
    return new MySqlComputerLifecycleManager(props);
}

// Default export
export default MySqlAgentMemoryManager;
