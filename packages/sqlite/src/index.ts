import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
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
import { Database } from "bun:sqlite";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema";
import {
    byoaiAgentMemories,
    byoaiComputerSessions,
    byoaiTranscripts,
    byoaiUserTokens,
} from "./schema";

export * from "./schema";

export interface SqlitePersistenceProperties {
    path?: string;
    filePath?: string;
    url?: string;
    URL?: string;
    filename?: string;
    readonly?: boolean;
    create?: boolean;
    [key: string]: any;
}

function resolveDbPath(props?: SqlitePersistenceProperties): string {
    let p =
        props?.path ??
        props?.filePath ??
        props?.filename ??
        props?.url ??
        props?.URL ??
        process.env.SQLITE_PATH ??
        ":memory:";

    if (p.startsWith("sqlite://")) {
        p = p.replace(/^sqlite:\/\//, "");
    }
    return p;
}

function createSqliteDatabase(props?: SqlitePersistenceProperties): Database {
    const dbPath = resolveDbPath(props);
    if (dbPath !== ":memory:") {
        const dir = dirname(dbPath);
        if (dir && dir !== ".") {
            mkdirSync(dir, { recursive: true });
        }
    }
    return new Database(dbPath, {
        readonly: props?.readonly ?? false,
        create: props?.create ?? true,
    });
}

function runSchemaDDL(db: Database): void {
    db.run("PRAGMA foreign_keys = ON;");
    db.run(`
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

        CREATE TABLE IF NOT EXISTS byoai_transcripts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            agent_id TEXT NOT NULL REFERENCES byoai_agent_memories(id) ON DELETE CASCADE,
            entry TEXT NOT NULL,
            created_at INTEGER
        );

        CREATE INDEX IF NOT EXISTS idx_sqlite_byoai_transcripts_agent_id ON byoai_transcripts(agent_id);

        CREATE TABLE IF NOT EXISTS byoai_user_tokens (
            user_id TEXT PRIMARY KEY,
            access_token TEXT,
            token_type TEXT,
            expires_at INTEGER,
            extra_headers TEXT,
            updated_at INTEGER
        );

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
 * SQLite Drizzle-powered implementation of AgentMemoryManager.
 */
export class SqliteAgentMemoryManager implements AgentMemoryManager {
    public readonly client: Database;
    public readonly db: BunSQLiteDatabase<typeof schema>;
    private initialized = false;

    constructor(
        props?:
            | SqlitePersistenceProperties
            | Database
            | BunSQLiteDatabase<typeof schema>
            | any,
    ) {
        if (props && "select" in props && typeof props.select === "function") {
            this.db = props;
            this.client = (props as any).session?.client;
        } else if (props && props instanceof Database) {
            this.client = props;
            this.db = drizzle(this.client, { schema });
        } else {
            this.client = createSqliteDatabase(props);
            this.db = drizzle(this.client, { schema });
        }
    }

    async init(): Promise<void> {
        if (!this.initialized) {
            if (this.client) {
                runSchemaDDL(this.client);
            }
            this.initialized = true;
        }
    }

    async createAgentMemoryEntry(
        name: string,
        userId: string,
        mode: InteractiveMode = "interactive",
        parentId?: string,
    ): Promise<string> {
        await this.init();
        const id = randomUUID();
        this.db
            .insert(byoaiAgentMemories)
            .values({
                id,
                name,
                userId,
                mode,
                parentId: parentId ?? null,
                createdAt: Date.now(),
            })
            .run();
        return id;
    }

    async getAgentMemory(agentId: string): Promise<AgentMemory> {
        await this.init();
        const [meta] = this.db
            .select()
            .from(byoaiAgentMemories)
            .where(eq(byoaiAgentMemories.id, agentId))
            .all();

        if (!meta) {
            throw new Error(`Agent ${agentId} not found`);
        }

        const transcriptRows = this.db
            .select({ entry: byoaiTranscripts.entry })
            .from(byoaiTranscripts)
            .where(eq(byoaiTranscripts.agentId, agentId))
            .orderBy(asc(byoaiTranscripts.id))
            .all();

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
            this.db
                .insert(byoaiTranscripts)
                .values({
                    agentId,
                    entry: entry as any,
                    createdAt: Date.now(),
                })
                .run();
        }
    }

    async setComputerId(agentId: string, computerId: string): Promise<void> {
        await this.init();
        this.db
            .update(byoaiAgentMemories)
            .set({ computerId })
            .where(eq(byoaiAgentMemories.id, agentId))
            .run();
    }

    async setSkillsPath(agentId: string, skillsPath: string): Promise<void> {
        await this.init();
        this.db
            .update(byoaiAgentMemories)
            .set({ skillsPath })
            .where(eq(byoaiAgentMemories.id, agentId))
            .run();
    }

    async setName(agentId: string, name: string): Promise<void> {
        await this.init();
        this.db
            .update(byoaiAgentMemories)
            .set({ name })
            .where(eq(byoaiAgentMemories.id, agentId))
            .run();
    }

    async getAgent(id: string): Promise<AgentHandle | undefined> {
        await this.init();
        const [row] = this.db
            .select()
            .from(byoaiAgentMemories)
            .where(eq(byoaiAgentMemories.id, id))
            .all();

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
        const [row] = this.db
            .select()
            .from(byoaiAgentMemories)
            .where(
                and(
                    eq(byoaiAgentMemories.id, id),
                    eq(byoaiAgentMemories.userId, userId),
                ),
            )
            .all();

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
        const rows = this.db
            .select({ id: byoaiAgentMemories.id })
            .from(byoaiAgentMemories)
            .orderBy(desc(byoaiAgentMemories.createdAt))
            .all();

        return rows.map((r) => r.id);
    }

    async getAllAgentsByUser(userId: string): Promise<string[]> {
        await this.init();
        const rows = this.db
            .select({ id: byoaiAgentMemories.id })
            .from(byoaiAgentMemories)
            .where(eq(byoaiAgentMemories.userId, userId))
            .orderBy(desc(byoaiAgentMemories.createdAt))
            .all();

        return rows.map((r) => r.id);
    }

    async getSubAgents(parentId: string): Promise<string[]> {
        await this.init();
        const rows = this.db
            .select({ id: byoaiAgentMemories.id })
            .from(byoaiAgentMemories)
            .where(eq(byoaiAgentMemories.parentId, parentId))
            .orderBy(desc(byoaiAgentMemories.createdAt))
            .all();

        return rows.map((r) => r.id);
    }

    async destroy(): Promise<void> {
        if (this.client && typeof this.client.close === "function") {
            this.client.close();
        }
    }
}

/**
 * SQLite Drizzle-powered implementation of UserTokenManager.
 */
export class SqliteUserTokenManager implements UserTokenManager {
    public readonly client: Database;
    public readonly db: BunSQLiteDatabase<typeof schema>;
    private initialized = false;

    constructor(
        props?:
            | SqlitePersistenceProperties
            | Database
            | BunSQLiteDatabase<typeof schema>
            | any,
    ) {
        if (props && "select" in props && typeof props.select === "function") {
            this.db = props;
            this.client = (props as any).session?.client;
        } else if (props && props instanceof Database) {
            this.client = props;
            this.db = drizzle(this.client, { schema });
        } else {
            this.client = createSqliteDatabase(props);
            this.db = drizzle(this.client, { schema });
        }
    }

    async init(): Promise<void> {
        if (!this.initialized) {
            if (this.client) {
                runSchemaDDL(this.client);
            }
            this.initialized = true;
        }
    }

    private getExpirationMs(expiresAt?: number): number | undefined {
        if (expiresAt === undefined) return undefined;
        return expiresAt < 1e11 ? expiresAt * 1000 : expiresAt;
    }

    async getUserToken(userId: string): Promise<AuthContext | undefined> {
        await this.init();
        const [row] = this.db
            .select()
            .from(byoaiUserTokens)
            .where(eq(byoaiUserTokens.userId, userId))
            .all();

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

        this.db
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
            })
            .run();
    }

    async clearUserToken(userId: string): Promise<void> {
        await this.init();
        this.db
            .delete(byoaiUserTokens)
            .where(eq(byoaiUserTokens.userId, userId))
            .run();
    }

    async destroy(): Promise<void> {
        if (this.client && typeof this.client.close === "function") {
            this.client.close();
        }
    }
}

/**
 * SQLite Drizzle-powered implementation of ComputerLifecycleManager.
 */
export class SqliteComputerLifecycleManager implements ComputerLifecycleManager {
    public readonly client: Database;
    public readonly db: BunSQLiteDatabase<typeof schema>;
    private initialized = false;

    constructor(
        props?:
            | SqlitePersistenceProperties
            | Database
            | BunSQLiteDatabase<typeof schema>
            | any,
    ) {
        if (props && "select" in props && typeof props.select === "function") {
            this.db = props;
            this.client = (props as any).session?.client;
        } else if (props && props instanceof Database) {
            this.client = props;
            this.db = drizzle(this.client, { schema });
        } else {
            this.client = createSqliteDatabase(props);
            this.db = drizzle(this.client, { schema });
        }
    }

    async init(): Promise<void> {
        if (!this.initialized) {
            if (this.client) {
                runSchemaDDL(this.client);
            }
            this.initialized = true;
        }
    }

    async getComputer(
        scope: ComputerLifecycleScope,
    ): Promise<ComputerSessionRecord | undefined> {
        await this.init();
        const key = getComputerLifecycleStorageKey(scope);
        const [row] = this.db
            .select()
            .from(byoaiComputerSessions)
            .where(eq(byoaiComputerSessions.key, key))
            .all();

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
        this.db
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
            })
            .run();
    }

    async removeComputer(scope: ComputerLifecycleScope): Promise<void> {
        await this.init();
        const key = getComputerLifecycleStorageKey(scope);
        this.db
            .delete(byoaiComputerSessions)
            .where(eq(byoaiComputerSessions.key, key))
            .run();
    }

    async clear(): Promise<void> {
        await this.init();
        this.db.delete(byoaiComputerSessions).run();
    }

    async destroy(): Promise<void> {
        if (this.client && typeof this.client.close === "function") {
            this.client.close();
        }
    }
}

// Named exports for all 3 managers
export {
    SqliteAgentMemoryManager as AgentMemoryManager,
    SqliteAgentMemoryManager as ChatMemory,
    SqliteUserTokenManager as UserTokenManager,
    SqliteUserTokenManager as TokenStore,
    SqliteComputerLifecycleManager as ComputerLifecycleManager,
    SqliteComputerLifecycleManager as ComputerStore,
};

// Factory functions
export function createAgentMemoryManager(
    props?: SqlitePersistenceProperties,
): SqliteAgentMemoryManager {
    return new SqliteAgentMemoryManager(props);
}

export function createChatMemory(
    props?: SqlitePersistenceProperties,
): SqliteAgentMemoryManager {
    return new SqliteAgentMemoryManager(props);
}

export function createTokenStore(
    props?: SqlitePersistenceProperties,
): SqliteUserTokenManager {
    return new SqliteUserTokenManager(props);
}

export function createUserTokenManager(
    props?: SqlitePersistenceProperties,
): SqliteUserTokenManager {
    return new SqliteUserTokenManager(props);
}

export function createComputerStore(
    props?: SqlitePersistenceProperties,
): SqliteComputerLifecycleManager {
    return new SqliteComputerLifecycleManager(props);
}

export function createComputerLifecycleManager(
    props?: SqlitePersistenceProperties,
): SqliteComputerLifecycleManager {
    return new SqliteComputerLifecycleManager(props);
}

// Default export
export default SqliteAgentMemoryManager;
