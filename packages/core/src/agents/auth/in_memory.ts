import type { AuthContext, UserTokenManager } from "../agent.auth";

/**
 * In-memory implementation of UserTokenManager with automatic timer-based expiration and cleanup.
 */
export class InMemoryUserTokenManager implements UserTokenManager {
    private tokens: Map<string, AuthContext> = new Map();
    private timers: Map<string, ReturnType<typeof setTimeout>> = new Map();

    private getExpirationMs(expiresAt?: number): number | undefined {
        if (expiresAt === undefined) return undefined;
        // Convert JWT seconds (RFC 7519) to milliseconds if needed
        return expiresAt < 1e11 ? expiresAt * 1000 : expiresAt;
    }

    async getUserToken(userId: string): Promise<AuthContext | undefined> {
        const token = this.tokens.get(userId);
        if (!token) return undefined;

        const expMs = this.getExpirationMs(token.expiresAt);
        if (expMs !== undefined && Date.now() >= expMs) {
            await this.clearUserToken(userId);
            return undefined;
        }

        return token;
    }

    async setUserToken(userId: string, authContext: AuthContext): Promise<void> {
        this.clearTimer(userId);

        const expMs = this.getExpirationMs(authContext.expiresAt);
        if (expMs !== undefined) {
            const delayMs = expMs - Date.now();
            if (delayMs <= 0) {
                // Already expired
                this.tokens.delete(userId);
                return;
            }

            // Schedule automatic internal deletion upon expiration
            const timer = setTimeout(() => {
                this.clearUserToken(userId).catch(() => {});
            }, delayMs);

            if (
                typeof timer === "object" &&
                timer !== null &&
                "unref" in timer &&
                typeof (timer as any).unref === "function"
            ) {
                (timer as any).unref();
            }

            this.timers.set(userId, timer);
        }

        this.tokens.set(userId, authContext);
    }

    async clearUserToken(userId: string): Promise<void> {
        this.clearTimer(userId);
        this.tokens.delete(userId);
    }

    private clearTimer(userId: string): void {
        const existingTimer = this.timers.get(userId);
        if (existingTimer) {
            clearTimeout(existingTimer);
            this.timers.delete(userId);
        }
    }

    destroy(): void {
        for (const timer of this.timers.values()) {
            clearTimeout(timer);
        }
        this.timers.clear();
        this.tokens.clear();
    }
}
