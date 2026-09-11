import fs from 'node:fs/promises'
import path from 'node:path'
import { parse } from 'yaml'
import { AgentConfigSchema, type AgentConfig, type ComputerUseToolProviderConfig, type ToolProviderConfig } from '@byo-ai-agent-platform/core/config'
import {
    AgentManager,
    InMemoryAgentCommunicator,
    InMemoryAgentMemoryManager,
    type Agent,
} from '@byo-ai-agent-platform/core/agents'
import { OpenAIModel, GeminiModel, AnthropicModel, SelfHostedModel, modelRegistry } from '@byo-ai-agent-platform/core/models'
import { ZipSkillRepository, GitSkillRepository, skillRepositoryRegistry } from '@byo-ai-agent-platform/core/skills'
import { ComputerUseToolProvider, OpenAPIToolProvider, toolProviderRegistry } from '@byo-ai-agent-platform/core/tools'
import { logger } from '@byo-ai-agent-platform/core/logger'
import { createComputerProvider, type ComputerProvider } from "@byo-ai-agent-platform/core/computer"

// ─── Config Loading ──────────────────────────────────────────────────
// Moved from core/config/config.ts — config loading is an app concern,
// not a library concern. The schemas themselves remain in core.

async function findConfigPath(): Promise<string | null> {
    // 1. Highest Priority: Explicit override via environment variable
    if (process.env.AGENT_CONFIG_PATH) {
        if (await fs.access(process.env.AGENT_CONFIG_PATH).then(() => true, () => false)) {
            return process.env.AGENT_CONFIG_PATH;
        }
    }

    // 2. Second Priority: Local development file in current directory
    const localPath = path.resolve(process.cwd(), "agent.yaml");
    if (await fs.access(localPath).then(() => true, () => false)) {
        return localPath;
    }

    // 3. Lowest Priority: Linux/Container standard system configuration path
    const systemPath = "/etc/agent/agent.yaml";
    if (await fs.access(systemPath).then(() => true, () => false)) {
        return systemPath;
    }

    // No file found anywhere
    return null;
}

export function interpolateEnvVars(content: string): string {
    return content.replace(/\$\{([^}]+)\}/g, (_, expression: string) => {
        const colonDashIndex = expression.indexOf(":-");
        if (colonDashIndex !== -1) {
            const varName = expression.slice(0, colonDashIndex);
            const defaultValue = expression.slice(colonDashIndex + 2);
            return process.env[varName] !== undefined && process.env[varName] !== ""
                ? process.env[varName]!
                : defaultValue;
        }
        return process.env[expression] ?? "";
    });
}

export async function loadConfig(configPath?: string): Promise<AgentConfig> {
    const resolvedConfigPath = configPath ?? await findConfigPath();

    if (!resolvedConfigPath) {
        throw new Error("No valid config file found.");
    }

    const configData = await fs.readFile(resolvedConfigPath, 'utf8');
    const interpolatedConfig = interpolateEnvVars(configData);
    const parsedConfig = parse(interpolatedConfig);

    return AgentConfigSchema.parse(parsedConfig);
}

export async function loadConfigIfAvailable(): Promise<AgentConfig | null> {
    const configPath = await findConfigPath();

    if (!configPath) {
        return null;
    }

    return loadConfig(configPath);
}

// ─── Model Registration ──────────────────────────────────────────────

export function registerModels(config: AgentConfig): void {
    for (const modelConfig of config.models) {
        const { name } = modelConfig;

        switch (modelConfig.brand) {
            case "openai": {
                if (!modelConfig.properties.apiKey) {
                    logger.warn(`Missing API key for OpenAI model: ${name}. Skipping registration.`);
                    continue;
                }
                logger.info(`Registering OpenAI model: ${name}`);
                modelRegistry.registerModel(name, new OpenAIModel(name, modelConfig.properties.apiKey));
                break;
            }
            case "gemini": {
                if (!modelConfig.properties.apiKey) {
                    logger.warn(`Missing API key for Gemini model: ${name}. Skipping registration.`);
                    continue;
                }
                logger.info(`Registering Gemini model: ${name}`);
                modelRegistry.registerModel(name, new GeminiModel(name, modelConfig.properties.apiKey));
                break;
            }
            case "anthropic": {
                if (!modelConfig.properties.apiKey) {
                    logger.warn(`Missing API key for Anthropic model: ${name}. Skipping registration.`);
                    continue;
                }
                logger.info(`Registering Anthropic model: ${name}`);
                modelRegistry.registerModel(name, new AnthropicModel(name, modelConfig.properties.apiKey, modelConfig.properties.maxTokens));
                break;
            }
            case "self_hosted": {
                logger.info(`Registering self-hosted model: ${name} with base URL: ${modelConfig.properties.baseUrl}`);
                modelRegistry.registerModel(name, new SelfHostedModel(modelConfig.properties.baseUrl, name, modelConfig.properties.apiKey));
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
                const zipRepo = new ZipSkillRepository(repoConfig.location, repoConfig.skillsSubdirectory, repoConfig.headers);
                skillRepositoryRegistry.registerSkillRepository(zipRepo);
                break;
            }
            case "git": {
                const gitRepo = new GitSkillRepository(repoConfig.url, repoConfig.branch, repoConfig.skillsSubdirectory, repoConfig.auth);
                skillRepositoryRegistry.registerSkillRepository(gitRepo);
                break;
            }
        }
    }
}

// ─── Tool Provider Registration ─────────────────────────────────────
let computerProvider: ComputerProvider | null = null;

function registerComputerToolProvider(toolProviders: ToolProviderConfig[]): void {
    const computerConfigs = toolProviders.filter(
        (p): p is ComputerUseToolProviderConfig => p.type === "computer"
    );

    if (computerConfigs.length > 1) {
        throw new Error(
            `There should only be 1 computer use tool provider declared, currently these are the declared computer tool providers: ${computerConfigs}`
        );
    }

    if (computerConfigs.length === 1 && computerConfigs[0]) {
        computerProvider = createComputerProvider(computerConfigs[0]);
        toolProviderRegistry.registerToolProvider(new ComputerUseToolProvider(computerProvider));
    }
}

export function registerToolProviders(config: AgentConfig): void {
    for (const providerConfig of config.toolProviders) {
        if (providerConfig.type === "openapi") {
            const openApiProvider = new OpenAPIToolProvider(providerConfig);
            toolProviderRegistry.registerToolProvider(openApiProvider);
        }
    }

    // Computer use tool provider (at most one allowed)
    registerComputerToolProvider(config.toolProviders);
}

// ─── Bootstrap ──────────────────────────────────────────────────────

export interface BootstrappedAgent {
    manager: AgentManager;
    agent: Agent;
    communicator: InMemoryAgentCommunicator;
}

export async function bootstrap(): Promise<BootstrappedAgent> {
    const config = await loadConfigIfAvailable();

    if (config) {
        registerModels(config);
        registerSkillRepositories(config);
        registerToolProviders(config);
    }

    const defaultModel = modelRegistry.getDefaultModel();
    if (!defaultModel) {
        throw new Error("No model registered in the model registry. Cannot create agent.");
    }

    const communicator = new InMemoryAgentCommunicator();
    const memoryManager = new InMemoryAgentMemoryManager();

    const manager = new AgentManager({
        name: "agent",
        description: "You are a helpful assistant.",
        model: defaultModel,
        skillRepository: skillRepositoryRegistry.getAllSkillRepositories(),
        toolProviders: toolProviderRegistry.getAllToolProviders(),
        memoryManager,
        communicator,
        computerProvider: computerProvider ?? undefined,
    });

    await manager.init();
    const agent = await manager.createAgent();

    return {
        manager,
        agent,
        communicator,
    };
}
