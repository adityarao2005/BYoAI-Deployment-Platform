import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { AuthContext, UserTokenManager } from "../agent.auth";

/**
 * File-backed implementation of {@link UserTokenManager} that stores
 * user authentication credentials as JSON files on disk with atomic writes
 * and token expiration validation.
 */
export class JsonFileUserTokenManager implements UserTokenManager {
    private storageDir: string;
    private initialized = false;

    constructor(storageDir?: string) {
        this.storageDir =
            storageDir ?? path.resolve(process.cwd(), ".agent_tokens");
    }

    private async ensureStorageDir(): Promise<void> {
        if (!this.initialized) {
            await fs.mkdir(this.storageDir, { recursive: true });
            this.initialized = true;
        }
    }

    private getFilePath(userId: string): string {
        const safeUserId = encodeURIComponent(userId);
        return path.join(this.storageDir, `${safeUserId}.json`);
    }

    private getExpirationMs(expiresAt?: number): number | undefined {
        if (expiresAt === undefined) return undefined;
        return expiresAt < 1e11 ? expiresAt * 1000 : expiresAt;
    }

    async getUserToken(userId: string): Promise<AuthContext | undefined> {
        await this.ensureStorageDir();
        const filePath = this.getFilePath(userId);
        try {
            const data = await fs.readFile(filePath, "utf-8");
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
        await this.ensureStorageDir();

        const expMs = this.getExpirationMs(authContext.expiresAt);
        if (expMs !== undefined && Date.now() >= expMs) {
            // Token is already expired, clear if exists
            await this.clearUserToken(userId);
            return;
        }

        const filePath = this.getFilePath(userId);
        const tempPath = `${filePath}.${crypto.randomUUID()}.tmp`;
        const data = JSON.stringify(authContext, null, 2);

        await fs.writeFile(tempPath, data, "utf-8");
        await fs.rename(tempPath, filePath);
    }

    async clearUserToken(userId: string): Promise<void> {
        await this.ensureStorageDir();
        const filePath = this.getFilePath(userId);
        try {
            await fs.unlink(filePath);
        } catch {
            // Ignore if file already deleted or doesn't exist
        }
    }
}
