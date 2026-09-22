import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
    type AgentCommunicator,
    AgentManager,
    type AgentObserver,
    ConsoleAgentObserver,
    InMemoryAgentCommunicator,
    InMemoryAgentMemoryManager,
    LoggingAgentObserver,
} from "@byo-ai-agent-platform/core/agents";
import { ConfigError } from "@byo-ai-agent-platform/core/errors";
import { configureLogger, getLogger } from "@byo-ai-agent-platform/core/logger";
import {
    type ComputerProvider,
    createComputerProvider,
} from "@byo-ai-agent-platform/core/computer";

import type { ComputerUseToolProviderConfig } from "@byo-ai-agent-platform/core/config";
import {
    AnthropicModel,
    GeminiModel,
    modelRegistry,
    OpenAIModel,
    SelfHostedModel,
} from "@byo-ai-agent-platform/core/models";
import {
    GitSkillRepository,
    skillRepositoryRegistry,
    ZipSkillRepository,
} from "@byo-ai-agent-platform/core/skills";
import {
    ComputerUseStdioMcpClientFactory,
    ComputerUseToolProvider,
    loadSkillToolProvider,
    type McpClientFactory,
    McpServerToolProvider,
    OpenAPIToolProvider,
    StdioMcpClientFactory,
    StreamableHTTPMcpClientFactory,
    toolProviderRegistry,
} from "@byo-ai-agent-platform/core/tools";
import { parse } from "yaml";
import { type AgentConfig, AgentConfigSchema } from "./agent.config";

// ─── Config Loading ──────────────────────────────────────────────────
// Moved from core/config/config.ts — config loading is an app concern,
// not a library concern. The schemas themselves remain in core.

async function findConfigPath(): Promise<string | null> {
    // 1. Highest Priority: Explicit override via environment variable
    if (process.env.AGENT_CONFIG_PATH) {
        if (
            await fs.access(process.env.AGENT_CONFIG_PATH).then(
                () => true,
                () => false,
            )
        ) {
            return process.env.AGENT_CONFIG_PATH;
        }
    }

    // 2. Second Priority: Local development file in current directory
    const localPath = path.resolve(process.cwd(), "agent.yaml");
    if (
        await fs.access(localPath).then(
            () => true,
            () => false,
        )
    ) {
        return localPath;
    }

    // 3. Lowest Priority: Linux/Container standard system configuration path
    const systemPath = "/etc/agent/agent.yaml";
    if (
        await fs.access(systemPath).then(
            () => true,
            () => false,
        )
    ) {
        return systemPath;
    }

    // No file found anywhere
    return null;
}

/**
 * Interpolates environment variables in the format `${VAR}` or `${VAR:-default}` within a raw string.
 *
 * @param content - Raw text containing environment variable references.
 * @returns Interpolated string with environment values expanded.
 */
export function interpolateEnvVars(content: string): string {
    return content.replace(/\$\{([^}]+)\}/g, (_, expression: string) => {
        const colonDashIndex = expression.indexOf(":-");
        if (colonDashIndex !== -1) {
            const varName = expression.slice(0, colonDashIndex);
            const defaultValue = expression.slice(colonDashIndex + 2);
            return process.env[varName] !== undefined &&
                process.env[varName] !== ""
                ? process.env[varName]
                : defaultValue;
        }
        return process.env[expression] ?? "";
    });
}

/**
 * Loads and parses an Agent configuration YAML file from the specified path or standard fallback locations.
 *
 * @param configPath - Optional explicit path to the configuration YAML file.
 * @returns Parsed and validated {@link AgentConfig}.
 * @throws Error if no configuration file is found or if parsing/validation fails.
 */
export async function loadConfig(configPath?: string): Promise<AgentConfig> {
    const resolvedConfigPath = configPath ?? (await findConfigPath());

    if (!resolvedConfigPath) {
        throw new ConfigError("No valid config file found.");
    }

    const configData = await fs.readFile(resolvedConfigPath, "utf8");
    const interpolatedConfig = interpolateEnvVars(configData);
    const parsedConfig = parse(interpolatedConfig);

    return AgentConfigSchema.parse(parsedConfig);
}

/**
 * Attempts to locate and load the agent configuration file if available.
 *
 * @returns Parsed {@link AgentConfig}, or `null` if no configuration file was discovered.
 */
export async function loadConfigIfAvailable(): Promise<AgentConfig | null> {
    const configPath = await findConfigPath();

    if (!configPath) {
        return null;
    }

    return loadConfig(configPath);
}

// ─── Model Registration ──────────────────────────────────────────────

const logger = getLogger("Bootstrap");

export function registerModels(config: AgentConfig): void {
    for (const modelConfig of config.models) {
        const { name } = modelConfig;

        switch (modelConfig.brand) {
            case "openai": {
                if (!modelConfig.properties.apiKey) {
                    logger.warn(`Skipping OpenAI model ${name}: missing API key`);
                    continue;
                }
                modelRegistry.registerModel(
                    name,
                    new OpenAIModel(name, modelConfig.properties.apiKey),
                );
                logger.info(`Registered OpenAI model: ${name}`);
                break;
            }
            case "gemini": {
                if (!modelConfig.properties.apiKey) {
                    logger.warn(`Skipping Gemini model ${name}: missing API key`);
                    continue;
                }
                modelRegistry.registerModel(
                    name,
                    new GeminiModel(name, modelConfig.properties.apiKey),
                );
                logger.info(`Registered Gemini model: ${name}`);
                break;
            }
            case "anthropic": {
                if (!modelConfig.properties.apiKey) {
                    logger.warn(`Skipping Anthropic model ${name}: missing API key`);
                    continue;
                }
                modelRegistry.registerModel(
                    name,
                    new AnthropicModel(
                        name,
                        modelConfig.properties.apiKey,
                        modelConfig.properties.maxTokens,
                    ),
                );
                logger.info(`Registered Anthropic model: ${name}`);
                break;
            }
            case "self_hosted": {
                modelRegistry.registerModel(
                    name,
                    new SelfHostedModel(
                        modelConfig.properties.baseUrl,
                        name,
                        modelConfig.properties.apiKey,
                    ),
                );
                logger.info(`Registered Self-Hosted model: ${name}`, {
                    baseUrl: modelConfig.properties.baseUrl,
                });
                break;
            }
        }
    }
}

// ─── Skill Repository Registration ──────────────────────────────────

export function registerSkillRepositories(config: AgentConfig): void {
    for (const repoConfig of config.skillRepositories) {
        switch (repoConfig.type) {
            case "zip": {
                const zipRepo = new ZipSkillRepository(
                    repoConfig.location,
                    repoConfig.skillsSubdirectory,
                    repoConfig.headers,
                );
                skillRepositoryRegistry.registerSkillRepository(zipRepo);
                logger.info("Registered Zip skill repository", {
                    location: repoConfig.location,
                });
                break;
            }
            case "git": {
                const gitRepo = new GitSkillRepository(
                    repoConfig.url,
                    repoConfig.branch,
                    repoConfig.skillsSubdirectory,
                    repoConfig.auth,
                );
                skillRepositoryRegistry.registerSkillRepository(gitRepo);
                logger.info("Registered Git skill repository", {
                    url: repoConfig.url,
                    branch: repoConfig.branch,
                });
                break;
            }
        }
    }
}

// ─── Computer Registration ──────────────────────────────────────────

export function registerComputer(
    config: AgentConfig,
): ComputerProvider | undefined {
    const computerConfigs = config.toolProviders.filter(
        (p): p is ComputerUseToolProviderConfig => p.type === "computer",
    );

    if (computerConfigs.length > 1) {
        throw new ConfigError(
            `There should only be 1 computer use tool provider declared, currently these are the declared computer tool providers: ${computerConfigs}`,
        );
    }

    if (computerConfigs.length === 1 && computerConfigs[0]) {
        logger.info("Initializing computer provider", {
            type: computerConfigs[0].provider.type,
        });
        return createComputerProvider(computerConfigs[0]);
    }

    return undefined;
}

// ─── Tool Provider Registration ─────────────────────────────────────

export function registerToolProviders(
    config: AgentConfig,
    computer?: ComputerProvider,
): void {
    // Check if a computer is registered, and if so register the ComputerUseToolProvider
    const activeComputer =
        computer !== undefined ? computer : registerComputer(config);

    if (activeComputer) {
        toolProviderRegistry.registerToolProvider(
            new ComputerUseToolProvider(activeComputer),
        );
        logger.info("Registered ComputerUseToolProvider");
    }

    for (const providerConfig of config.toolProviders) {
        if (providerConfig.type === "openapi") {
            const openApiProvider = new OpenAPIToolProvider(providerConfig);
            toolProviderRegistry.registerToolProvider(openApiProvider);
            logger.info("Registered OpenAPIToolProvider", {
                name: providerConfig.name,
            });
        } else if (providerConfig.type === "mcp") {
            let clientFactory: McpClientFactory;

            switch (providerConfig.transport) {
                case "stdio":
                    clientFactory = new StdioMcpClientFactory(providerConfig);
                    break;
                case "computer":
                    if (activeComputer)
                        clientFactory = new ComputerUseStdioMcpClientFactory(
                            providerConfig,
                            activeComputer,
                        );
                    else {
                        throw new ConfigError(
                            `Cannot create the mcp tool provider ${providerConfig.name}. There is no computer provider added.`,
                        );
                    }
                    break;
                case "http":
                    clientFactory = new StreamableHTTPMcpClientFactory(
                        providerConfig,
                    );
                    break;
            }

            toolProviderRegistry.registerToolProvider(
                new McpServerToolProvider(clientFactory),
            );
            logger.info("Registered McpServerToolProvider", {
                name: providerConfig.name,
                transport: providerConfig.transport,
            });
        }
    }
}

/**
 * Container holding the fully initialized agent, agent manager, and communicator.
 */
export interface BootstrappedAgent {
    /** Active AgentManager instance governing the agent lifecycle */
    manager: AgentManager;

    /** Agent Configuration  */
    config: AgentConfig;
}

/**
 * Options for configuring the agent bootstrap process.
 */
export interface BootstrapOptions {
    /** Custom observers to monitor agent execution events */
    observers?: AgentObserver[];
}

/**
 * Bootstraps the agentic harness by loading configuration, registering models, skills, tools, and computer providers.
 *
 * @param options - Optional bootstrap options including observers.
 * @returns Object containing the bootstrapped agent, manager, and communicator.
 */
export async function bootstrap(
    options?: BootstrapOptions,
): Promise<BootstrappedAgent> {
    const config = await loadConfigIfAvailable();

    let computer: ComputerProvider | undefined;

    if (!config) {
        throw new Error("Config was not able to be loaded for reasons unspecified")
    }
    
    registerModels(config);
    registerSkillRepositories(config);
    computer = registerComputer(config);
    registerToolProviders(config, computer);


    const defaultModel = modelRegistry.getDefaultModel();
    if (!defaultModel) {
        throw new Error(
            "No model registered in the model registry. Cannot create agent.",
        );
    }

    const communicator = new InMemoryAgentCommunicator();
    const memoryManager = new InMemoryAgentMemoryManager();

    const skillRepos = skillRepositoryRegistry.getAllSkillRepositories();
    const toolProviders = [
        ...toolProviderRegistry.getAllToolProviders(),
        ...(skillRepos.length > 0 ? [loadSkillToolProvider(skillRepos)] : []),
    ];

    const observers = options?.observers ?? [
        new LoggingAgentObserver(),
        new ConsoleAgentObserver(),
    ];

    logger.info("Bootstrapping Agentic Harness", {
        model: defaultModel.name,
        skillReposCount: skillRepos.length,
        toolProvidersCount: toolProviders.length,
        hasComputer: computer !== undefined,
    });

    const manager = new AgentManager({
        name: config?.name ?? `agent-${randomUUID()}`,
        description: config?.description ?? "You are a helpful assistant.",
        model: defaultModel,
        skillRepository: skillRepos,
        toolProviders,
        memoryManager,
        communicator,
        computerProvider: computer,
        observers,
    });

    await manager.init();

    logger.info("Agentic Harness bootstrap complete", {
        agentName: config?.name,
    });

    return {
        manager,
        config,
    };
}
