import {
    type AuthContext,
    type ComputerLifecycleManager,
    type ComputerLifecycleScope,
    type ComputerSessionRecord,
    type UserTokenManager,
    getComputerLifecycleStorageKey,
} from "@byo-ai-agent-platform/core/agents";
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

// Default export can serve as UserTokenManager or factory
export default RedisUserTokenManager;

export function createTokenStore(
    props?: RedisPersistenceProperties,
): RedisUserTokenManager {
    return new RedisUserTokenManager(props);
}

export function createComputerStore(
    props?: RedisPersistenceProperties,
): RedisComputerLifecycleManager {
    return new RedisComputerLifecycleManager(props);
}
