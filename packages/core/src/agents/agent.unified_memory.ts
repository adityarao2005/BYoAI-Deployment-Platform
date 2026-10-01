import type { UserTokenManager } from "./agent.auth";
import type { ComputerLifecycleManager } from "./agent.computer_lifecycle";
import type { AgentMemoryManager } from "./agent.memory";
import { InMemoryUserTokenManager } from "./auth";
import { InMemoryComputerLifecycleManager } from "./computer_lifecycle";
import { InMemoryAgentMemoryManager } from "./memory";

/**
 * Unified memory manager providing coordinated access to agent state,
 * user authentication credentials, and computer lifecycle sessions.
 */
export interface MemoryManager {
    /** Agent conversation transcripts and interaction metadata. */
    readonly agent: AgentMemoryManager;
    /** User OAuth2 and authentication token store. */
    readonly userToken: UserTokenManager;
    /** Computer session lifecycle manager. */
    readonly computerLifecycle: ComputerLifecycleManager;
}

/**
 * Options for configuring {@link CompositeMemoryManager}.
 */
export interface CompositeMemoryManagerOptions {
    agent?: AgentMemoryManager;
    userToken?: UserTokenManager;
    computerLifecycle?: ComputerLifecycleManager;
}

/**
 * Composite implementation of {@link MemoryManager} that combines individual
 * memory providers, defaulting to in-memory implementations.
 */
export class CompositeMemoryManager implements MemoryManager {
    readonly agent: AgentMemoryManager;
    readonly userToken: UserTokenManager;
    readonly computerLifecycle: ComputerLifecycleManager;

    constructor(options?: CompositeMemoryManagerOptions) {
        this.agent = options?.agent ?? new InMemoryAgentMemoryManager();
        this.userToken = options?.userToken ?? new InMemoryUserTokenManager();
        this.computerLifecycle =
            options?.computerLifecycle ?? new InMemoryComputerLifecycleManager();
    }
}

/**
 * Type guard to check whether an object implements {@link MemoryManager}.
 */
export function isMemoryManager(value: unknown): value is MemoryManager {
    return (
        typeof value === "object" &&
        value !== null &&
        "agent" in value &&
        "userToken" in value &&
        "computerLifecycle" in value
    );
}

/**
 * Normalizes input memory manager configuration into a full {@link MemoryManager}.
 * If the input is already a {@link MemoryManager}, it is returned directly.
 * If it is an {@link AgentMemoryManager} or undefined, it is wrapped in a {@link CompositeMemoryManager}.
 */
export function normalizeMemoryManager(
    memoryManager?: MemoryManager | AgentMemoryManager,
    options?: {
        userTokenManager?: UserTokenManager;
        computerLifecycleManager?: ComputerLifecycleManager;
    },
): MemoryManager {
    if (isMemoryManager(memoryManager)) {
        return memoryManager;
    }
    return new CompositeMemoryManager({
        agent: memoryManager,
        userToken: options?.userTokenManager,
        computerLifecycle: options?.computerLifecycleManager,
    });
}
