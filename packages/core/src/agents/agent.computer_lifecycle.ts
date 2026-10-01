import type { ComputerLifecycle } from "@/config/tool_config";

/**
 * Contextual scope used to identify and retrieve a computer session based on its lifecycle tier.
 */
export interface ComputerLifecycleScope {
    /** The computer lifecycle mode ("server", "user", "interaction"). */
    lifecycle: ComputerLifecycle;
    /** The name of the agent. */
    agentName: string;
    /** The user identifier. */
    userId: string;
    /** The unique interaction / agent memory identifier. */
    interactionId: string;
}

/**
 * Persisted record containing the computer session details.
 */
export interface ComputerSessionRecord {
    /** Unique identifier for the computer session. */
    computerId: string;
    /** The lifecycle mode of the session. */
    lifecycle: ComputerLifecycle;
    /** Path to extracted skills on the computer, if skills were transferred. */
    skillsPath?: string;
    /** Epoch timestamp in milliseconds when this record was created. */
    createdAt?: number;
}

/**
 * Generates the standardized storage key for a given lifecycle scope.
 */
export function getComputerLifecycleStorageKey(
    scope: ComputerLifecycleScope,
): string {
    switch (scope.lifecycle) {
        case "server":
            return `server:${scope.agentName}`;
        case "user":
            return `user:${scope.agentName}:${scope.userId}`;
        case "interaction":
            return `interaction:${scope.interactionId}`;
    }
}

/**
 * Interface for managing and persisting computer session lifecycles.
 */
export interface ComputerLifecycleManager {
    /**
     * Retrieves an existing computer session record for the given scope, if one exists.
     */
    getComputer(
        scope: ComputerLifecycleScope,
    ): Promise<ComputerSessionRecord | undefined>;

    /**
     * Stores or updates a computer session record for the given scope.
     */
    setComputer(
        scope: ComputerLifecycleScope,
        record: ComputerSessionRecord,
    ): Promise<void>;

    /**
     * Removes the computer session record for the given scope.
     */
    removeComputer(scope: ComputerLifecycleScope): Promise<void>;

    /**
     * Clears all stored computer sessions.
     */
    clear(): Promise<void>;
}
