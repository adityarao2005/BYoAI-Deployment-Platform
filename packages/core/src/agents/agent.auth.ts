/**
 * Authentication context representing credentials (e.g. OAuth2 tokens) for a user session.
 */
export interface AuthContext {
    accessToken?: string;
    idToken?: string;
    tokenType?: string;
    expiresAt?: number;
    extraHeaders?: Record<string, string>;
}

/**
 * Interface for managing user authentication tokens across clustered sessions.
 */
export interface UserTokenManager {
    /** Retrieves active authentication context for a given user ID */
    getUserToken(userId: string): Promise<AuthContext | undefined>;

    /** Sets authentication context for a given user ID */
    setUserToken(userId: string, authContext: AuthContext): Promise<void>;

    /** Clears authentication context for a given user ID */
    clearUserToken(userId: string): Promise<void>;
}
