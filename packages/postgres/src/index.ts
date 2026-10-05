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
import pg, { type PoolConfig } from "pg";

const { Pool } = pg;

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

async function runSchemaDDL(pool: pg.Pool): Promise<void> {
    const client = await pool.connect();
    try {
        await client.query(`
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
    } finally {
        client.release();
    }
}

/**
 * PostgreSQL implementation of AgentMemoryManager.
 */
export class PostgresAgentMemoryManager implements AgentMemoryManager {
    public readonly pool: pg.Pool;
    private initPromise: Promise<void> | null = null;

    constructor(props?: PostgresPersistenceProperties | pg.Pool | any) {
        if (props && ("query" in props || props instanceof Pool)) {
            this.pool = props;
        } else {
            this.pool = createPool(props);
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
        await this.pool.query(
            `INSERT INTO byoai_agent_memories (id, name, user_id, mode, parent_id)
             VALUES ($1, $2, $3, $4, $5)`,
            [id, name, userId, mode, parentId ?? null],
        );
        return id;
    }

    async getAgentMemory(agentId: string): Promise<AgentMemory> {
        await this.init();
        const metaRes = await this.pool.query(
            `SELECT id, name, user_id, mode, parent_id, computer_id, skills_path
             FROM byoai_agent_memories WHERE id = $1`,
            [agentId],
        );
        if (metaRes.rows.length === 0) {
            throw new Error(`Agent ${agentId} not found`);
        }
        const meta = metaRes.rows[0];

        const transcriptRes = await this.pool.query(
            `SELECT entry FROM byoai_transcripts
             WHERE agent_id = $1 ORDER BY id ASC`,
            [agentId],
        );

        const transcript: ModelInteraction[] = transcriptRes.rows.map(
            (r: any) => r.entry,
        );

        return new AgentMemory(
            meta.name,
            meta.user_id,
            transcript,
            meta.computer_id ?? undefined,
            meta.skills_path ?? undefined,
            meta.mode as InteractiveMode,
            meta.parent_id ?? undefined,
        );
    }

    async addTranscriptEntries(
        agentId: string,
        conversationEntries: ModelInteraction[],
    ): Promise<void> {
        if (conversationEntries.length === 0) return;
        await this.init();

        const client = await this.pool.connect();
        try {
            await client.query("BEGIN");
            for (const entry of conversationEntries) {
                await client.query(
                    `INSERT INTO byoai_transcripts (agent_id, entry) VALUES ($1, $2)`,
                    [agentId, JSON.stringify(entry)],
                );
            }
            await client.query("COMMIT");
        } catch (err) {
            await client.query("ROLLBACK");
            throw err;
        } finally {
            client.release();
        }
    }

    async setComputerId(agentId: string, computerId: string): Promise<void> {
        await this.init();
        await this.pool.query(
            `UPDATE byoai_agent_memories SET computer_id = $1 WHERE id = $2`,
            [computerId, agentId],
        );
    }

    async setSkillsPath(agentId: string, skillsPath: string): Promise<void> {
        await this.init();
        await this.pool.query(
            `UPDATE byoai_agent_memories SET skills_path = $1 WHERE id = $2`,
            [skillsPath, agentId],
        );
    }

    async setName(agentId: string, name: string): Promise<void> {
        await this.init();
        await this.pool.query(
            `UPDATE byoai_agent_memories SET name = $1 WHERE id = $2`,
            [name, agentId],
        );
    }

    async getAgent(id: string): Promise<AgentHandle | undefined> {
        await this.init();
        const res = await this.pool.query(
            `SELECT id, name, user_id, mode, parent_id, computer_id FROM byoai_agent_memories WHERE id = $1`,
            [id],
        );
        if (res.rows.length === 0) return undefined;
        const row = res.rows[0];
        return {
            id: row.id,
            name: row.name,
            userId: row.user_id,
            computerId: row.computer_id ?? undefined,
            parentId: row.parent_id ?? undefined,
        };
    }

    async getAgentByUser(
        id: string,
        userId: string,
    ): Promise<AgentHandle | undefined> {
        await this.init();
        const res = await this.pool.query(
            `SELECT id, name, user_id, mode, parent_id, computer_id
             FROM byoai_agent_memories WHERE id = $1 AND user_id = $2`,
            [id, userId],
        );
        if (res.rows.length === 0) return undefined;
        const row = res.rows[0];
        return {
            id: row.id,
            name: row.name,
            userId: row.user_id,
            computerId: row.computer_id ?? undefined,
            parentId: row.parent_id ?? undefined,
        };
    }

    async getAllAgents(): Promise<string[]> {
        await this.init();
        const res = await this.pool.query(
            `SELECT id FROM byoai_agent_memories ORDER BY created_at DESC`,
        );
        return res.rows.map((r: any) => r.id);
    }

    async getAllAgentsByUser(userId: string): Promise<string[]> {
        await this.init();
        const res = await this.pool.query(
            `SELECT id FROM byoai_agent_memories WHERE user_id = $1 ORDER BY created_at DESC`,
            [userId],
        );
        return res.rows.map((r: any) => r.id);
    }

    async getSubAgents(parentId: string): Promise<string[]> {
        await this.init();
        const res = await this.pool.query(
            `SELECT id FROM byoai_agent_memories WHERE parent_id = $1 ORDER BY created_at DESC`,
            [parentId],
        );
        return res.rows.map((r: any) => r.id);
    }

    async destroy(): Promise<void> {
        await this.pool.end();
    }
}

/**
 * PostgreSQL implementation of UserTokenManager.
 */
export class PostgresUserTokenManager implements UserTokenManager {
    public readonly pool: pg.Pool;
    private initPromise: Promise<void> | null = null;

    constructor(props?: PostgresPersistenceProperties | pg.Pool | any) {
        if (props && ("query" in props || props instanceof Pool)) {
            this.pool = props;
        } else {
            this.pool = createPool(props);
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
        const res = await this.pool.query(
            `SELECT access_token, token_type, expires_at, extra_headers
             FROM byoai_user_tokens WHERE user_id = $1`,
            [userId],
        );
        if (res.rows.length === 0) return undefined;
        const row = res.rows[0];

        const expiresAtNum = row.expires_at ? Number(row.expires_at) : undefined;
        const expMs = this.getExpirationMs(expiresAtNum);
        if (expMs !== undefined && Date.now() >= expMs) {
            await this.clearUserToken(userId);
            return undefined;
        }

        return {
            accessToken: row.access_token ?? undefined,
            tokenType: row.token_type ?? undefined,
            expiresAt: expiresAtNum,
            extraHeaders: row.extra_headers ?? undefined,
        };
    }

    async setUserToken(userId: string, authContext: AuthContext): Promise<void> {
        await this.init();
        const expMs = this.getExpirationMs(authContext.expiresAt);
        if (expMs !== undefined && Date.now() >= expMs) {
            await this.clearUserToken(userId);
            return;
        }

        await this.pool.query(
            `INSERT INTO byoai_user_tokens (user_id, access_token, token_type, expires_at, extra_headers, updated_at)
             VALUES ($1, $2, $3, $4, $5, NOW())
             ON CONFLICT (user_id) DO UPDATE SET
                access_token = EXCLUDED.access_token,
                token_type = EXCLUDED.token_type,
                expires_at = EXCLUDED.expires_at,
                extra_headers = EXCLUDED.extra_headers,
                updated_at = NOW()`,
            [
                userId,
                authContext.accessToken ?? null,
                authContext.tokenType ?? null,
                authContext.expiresAt ?? null,
                authContext.extraHeaders ? JSON.stringify(authContext.extraHeaders) : null,
            ],
        );
    }

    async clearUserToken(userId: string): Promise<void> {
        await this.init();
        await this.pool.query(`DELETE FROM byoai_user_tokens WHERE user_id = $1`, [
            userId,
        ]);
    }

    async destroy(): Promise<void> {
        await this.pool.end();
    }
}

/**
 * PostgreSQL implementation of ComputerLifecycleManager.
 */
export class PostgresComputerLifecycleManager implements ComputerLifecycleManager {
    public readonly pool: pg.Pool;
    private initPromise: Promise<void> | null = null;

    constructor(props?: PostgresPersistenceProperties | pg.Pool | any) {
        if (props && ("query" in props || props instanceof Pool)) {
            this.pool = props;
        } else {
            this.pool = createPool(props);
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
        const res = await this.pool.query(
            `SELECT computer_id, lifecycle, skills_path, created_at
             FROM byoai_computer_sessions WHERE key = $1`,
            [key],
        );
        if (res.rows.length === 0) return undefined;
        const row = res.rows[0];
        return {
            computerId: row.computer_id,
            lifecycle: row.lifecycle,
            skillsPath: row.skills_path ?? undefined,
            createdAt: row.created_at ? Number(row.created_at) : undefined,
        };
    }

    async setComputer(
        scope: ComputerLifecycleScope,
        record: ComputerSessionRecord,
    ): Promise<void> {
        await this.init();
        const key = getComputerLifecycleStorageKey(scope);
        await this.pool.query(
            `INSERT INTO byoai_computer_sessions (key, computer_id, lifecycle, skills_path, created_at)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (key) DO UPDATE SET
                computer_id = EXCLUDED.computer_id,
                lifecycle = EXCLUDED.lifecycle,
                skills_path = EXCLUDED.skills_path,
                created_at = EXCLUDED.created_at`,
            [
                key,
                record.computerId,
                record.lifecycle,
                record.skillsPath ?? null,
                record.createdAt ?? Date.now(),
            ],
        );
    }

    async removeComputer(scope: ComputerLifecycleScope): Promise<void> {
        await this.init();
        const key = getComputerLifecycleStorageKey(scope);
        await this.pool.query(`DELETE FROM byoai_computer_sessions WHERE key = $1`, [
            key,
        ]);
    }

    async clear(): Promise<void> {
        await this.init();
        await this.pool.query(`TRUNCATE TABLE byoai_computer_sessions`);
    }

    async destroy(): Promise<void> {
        await this.pool.end();
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
