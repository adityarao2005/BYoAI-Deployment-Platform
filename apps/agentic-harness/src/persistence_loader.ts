import { createRequire } from "node:module";
import path from "node:path";
import {
    type AgentMemoryManager,
    type ComputerLifecycleManager,
    InMemoryAgentMemoryManager,
    InMemoryComputerLifecycleManager,
    InMemoryUserTokenManager,
    JsonFileAgentMemoryManager,
    JsonFileComputerLifecycleManager,
    JsonFileUserTokenManager,
    type MemoryManager,
    type UserTokenManager,
    CompositeMemoryManager,
} from "@byo-ai-agent-platform/core/agents";
import { ConfigError } from "@byo-ai-agent-platform/core/errors";
import { getLogger } from "@byo-ai-agent-platform/core/logger";
import {
    type NormalizedStoreConfig,
    type PersistenceConfig,
    type SingleStoreConfig,
    normalizePersistenceConfig,
    normalizeSingleStoreConfig,
} from "./agent.config";

const logger = getLogger();

/**
 * Dynamically resolves and imports a module given a package name or local file path.
 */
async function resolveDynamicModule(
    packageName: string,
    storeType: string,
): Promise<any> {
    if (
        packageName.startsWith(".") ||
        packageName.startsWith("/") ||
        packageName.startsWith("file://")
    ) {
        const resolvedPath =
            packageName.startsWith("file://") || path.isAbsolute(packageName)
                ? packageName
                : path.resolve(process.cwd(), packageName);
        try {
            return await import(resolvedPath);
        } catch (error) {
            throw new ConfigError(
                `Failed to load ${storeType} package from path "${resolvedPath}": ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    try {
        return await import(packageName);
    } catch (_err1) {
        try {
            const req = createRequire(
                path.resolve(process.cwd(), "package.json"),
            );
            const resolvedModule = req.resolve(packageName);
            return await import(resolvedModule);
        } catch (err2) {
            try {
                const localPath = path.resolve(
                    process.cwd(),
                    "node_modules",
                    packageName,
                );
                return await import(localPath);
            } catch {
                throw new ConfigError(
                    `Failed to dynamically resolve ${storeType} package "${packageName}". Ensure it is installed via "bun add ${packageName}" or present in node_modules: ${err2 instanceof Error ? err2.message : String(err2)}`,
                );
            }
        }
    }
}

/**
 * Instantiates a store manager from an exported class or factory function.
 */
async function instantiateStore(
    ExportCandidate: any,
    properties: Record<string, any>,
    packageName: string,
    storeType: string,
): Promise<any> {
    if (typeof ExportCandidate !== "function") {
        throw new ConfigError(
            `Export from ${storeType} package "${packageName}" is neither a constructor class nor a factory function.`,
        );
    }

    let instance: any;
    try {
        instance = new (ExportCandidate as any)(properties);
    } catch (_ctorErr) {
        instance = await (ExportCandidate as any)(properties);
    }

    if (!instance) {
        throw new ConfigError(
            `Failed to instantiate ${storeType} from package "${packageName}".`,
        );
    }

    if (typeof instance.init === "function") {
        await instance.init();
    }

    return instance;
}

/**
 * Creates and initializes an AgentMemoryManager instance for chatMemory.
 */
export async function createAgentMemoryManager(
    config?: SingleStoreConfig,
): Promise<AgentMemoryManager> {
    const normalized = normalizeSingleStoreConfig(config);

    if (normalized.type === "in_memory") {
        logger.info("Using InMemoryAgentMemoryManager");
        const manager = new InMemoryAgentMemoryManager();
        await (manager as any).init?.();
        return manager;
    }

    if (normalized.type === "json_files") {
        const storageDir =
            normalized.properties.dir ??
            normalized.properties.path ??
            normalized.properties.storageDir;
        logger.info("Using JsonFileAgentMemoryManager", { storageDir });
        const manager = new JsonFileAgentMemoryManager(storageDir);
        await (manager as any).init?.();
        return manager;
    }

    const packageName = normalized.provider!;
    logger.info("Loading dynamic AgentMemoryManager package", {
        package: packageName,
    });

    const mod = await resolveDynamicModule(packageName, "chatMemory");
    const Candidate =
        mod.AgentMemoryManager ??
        mod.ChatMemory ??
        mod.createAgentMemoryManager ??
        mod.createChatMemory ??
        mod.default;

    if (!Candidate) {
        throw new ConfigError(
            `ChatMemory package "${packageName}" does not export AgentMemoryManager, ChatMemory, createAgentMemoryManager, createChatMemory, or default`,
        );
    }

    const manager = await instantiateStore(
        Candidate,
        normalized.properties,
        packageName,
        "chatMemory",
    );

    if (
        typeof manager.getAgentMemory !== "function" ||
        typeof manager.createAgentMemoryEntry !== "function" ||
        typeof manager.addTranscriptEntries !== "function"
    ) {
        throw new ConfigError(
            `Package "${packageName}" did not return a valid AgentMemoryManager (must implement getAgentMemory, createAgentMemoryEntry, addTranscriptEntries).`,
        );
    }

    return manager;
}

/**
 * Creates and initializes a UserTokenManager instance for tokenStore.
 */
export async function createUserTokenManager(
    config?: SingleStoreConfig,
): Promise<UserTokenManager> {
    const normalized = normalizeSingleStoreConfig(config);

    if (normalized.type === "in_memory") {
        logger.info("Using InMemoryUserTokenManager");
        const manager = new InMemoryUserTokenManager();
        await (manager as any).init?.();
        return manager;
    }

    if (normalized.type === "json_files") {
        const storageDir =
            normalized.properties.dir ??
            normalized.properties.path ??
            normalized.properties.storageDir;
        logger.info("Using JsonFileUserTokenManager", { storageDir });
        const manager = new JsonFileUserTokenManager(storageDir);
        await (manager as any).init?.();
        return manager;
    }

    const packageName = normalized.provider!;
    logger.info("Loading dynamic UserTokenManager package", {
        package: packageName,
    });

    const mod = await resolveDynamicModule(packageName, "tokenStore");
    const Candidate =
        mod.UserTokenManager ??
        mod.TokenStore ??
        mod.createUserTokenManager ??
        mod.createTokenStore ??
        mod.default;

    if (!Candidate) {
        throw new ConfigError(
            `TokenStore package "${packageName}" does not export UserTokenManager, TokenStore, createUserTokenManager, createTokenStore, or default`,
        );
    }

    const manager = await instantiateStore(
        Candidate,
        normalized.properties,
        packageName,
        "tokenStore",
    );

    if (
        typeof manager.getUserToken !== "function" ||
        typeof manager.setUserToken !== "function" ||
        typeof manager.clearUserToken !== "function"
    ) {
        throw new ConfigError(
            `Package "${packageName}" did not return a valid UserTokenManager (must implement getUserToken, setUserToken, clearUserToken).`,
        );
    }

    return manager;
}

/**
 * Creates and initializes a ComputerLifecycleManager instance for computerStore.
 */
export async function createComputerLifecycleManager(
    config?: SingleStoreConfig,
): Promise<ComputerLifecycleManager> {
    const normalized = normalizeSingleStoreConfig(config);

    if (normalized.type === "in_memory") {
        logger.info("Using InMemoryComputerLifecycleManager");
        const manager = new InMemoryComputerLifecycleManager();
        await (manager as any).init?.();
        return manager;
    }

    if (normalized.type === "json_files") {
        const storageDir =
            normalized.properties.dir ??
            normalized.properties.path ??
            normalized.properties.storageDir;
        logger.info("Using JsonFileComputerLifecycleManager", { storageDir });
        const manager = new JsonFileComputerLifecycleManager(storageDir);
        await (manager as any).init?.();
        return manager;
    }

    const packageName = normalized.provider!;
    logger.info("Loading dynamic ComputerLifecycleManager package", {
        package: packageName,
    });

    const mod = await resolveDynamicModule(packageName, "computerStore");
    const Candidate =
        mod.ComputerLifecycleManager ??
        mod.ComputerStore ??
        mod.createComputerLifecycleManager ??
        mod.createComputerStore ??
        mod.default;

    if (!Candidate) {
        throw new ConfigError(
            `ComputerStore package "${packageName}" does not export ComputerLifecycleManager, ComputerStore, createComputerLifecycleManager, createComputerStore, or default`,
        );
    }

    const manager = await instantiateStore(
        Candidate,
        normalized.properties,
        packageName,
        "computerStore",
    );

    if (
        typeof manager.getComputer !== "function" ||
        typeof manager.setComputer !== "function" ||
        typeof manager.removeComputer !== "function" ||
        typeof manager.clear !== "function"
    ) {
        throw new ConfigError(
            `Package "${packageName}" did not return a valid ComputerLifecycleManager (must implement getComputer, setComputer, removeComputer, clear).`,
        );
    }

    return manager;
}

/**
 * Creates a unified CompositeMemoryManager combining the configured chatMemory,
 * tokenStore, and computerStore persistence managers.
 */
export async function createUnifiedMemoryManager(
    config?: PersistenceConfig,
): Promise<MemoryManager> {
    const normalized = normalizePersistenceConfig(config);

    const [agent, userToken, computerLifecycle] = await Promise.all([
        createAgentMemoryManager(normalized.chatMemory),
        createUserTokenManager(normalized.tokenStore),
        createComputerLifecycleManager(normalized.computerStore),
    ]);

    logger.info("Successfully initialized unified persistence managers", {
        chatMemory: normalized.chatMemory.type,
        tokenStore: normalized.tokenStore.type,
        computerStore: normalized.computerStore.type,
    });

    return new CompositeMemoryManager({
        agent,
        userToken,
        computerLifecycle,
    });
}
