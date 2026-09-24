import type { AuthContext, UserTokenManager } from "../agent.auth";

/**
 * In-memory implementation of UserTokenManager for local/testing environments.
 */
export class InMemoryUserTokenManager implements UserTokenManager {
    private tokens: Map<string, AuthContext> = new Map();

    async getUserToken(userId: string): Promise<AuthContext | undefined> {
        return this.tokens.get(userId);
    }

    async setUserToken(userId: string, authContext: AuthContext): Promise<void> {
        this.tokens.set(userId, authContext);
    }

    async clearUserToken(userId: string): Promise<void> {
        this.tokens.delete(userId);
    }
}
