import { z } from 'zod'
import fs from 'fs/promises'
import path from 'path'
import { parse } from 'yaml'
import { AgentConfigSchema, type AgentConfig } from '@byo-ai-agent-platform/core/config'
import { Agent } from '@byo-ai-agent-platform/core/agents/agents'
import { OpenAIModel } from '@byo-ai-agent-platform/core/models/openai'
import { GeminiModel } from '@byo-ai-agent-platform/core/models/gemini'
import { AnthropicModel } from '@byo-ai-agent-platform/core/models/anthropic'
import { SelfHostedModel } from '@byo-ai-agent-platform/core/models/self_hosted'
import { modelRegistry } from '@byo-ai-agent-platform/core/models/models'
import { ZipSkillRepository } from '@byo-ai-agent-platform/core/skills/zip_skill_repo'
import { GitSkillRepository } from '@byo-ai-agent-platform/core/skills/git_skill_repo'
import { skillRepositoryRegistry } from '@byo-ai-agent-platform/core/skills/skills'
import { OpenAPIToolProvider } from '@byo-ai-agent-platform/core/tools/openapi/provider'
import { createComputerUseToolProvider } from '@byo-ai-agent-platform/core/tools/computer_use/registry'
import { toolProviderRegistry } from '@byo-ai-agent-platform/core/tools/tools'
import { logger } from '@byo-ai-agent-platform/core/logger'

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

export async function loadConfig(configPath?: string): Promise<AgentConfig> {
    const resolvedConfigPath = configPath ?? await findConfigPath();

    if (!resolvedConfigPath) {
        throw new Error("No valid config file found.");
    }

    const configData = await fs.readFile(resolvedConfigPath, 'utf8');
    const parsedConfig = parse(configData);

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

function registerModels(config: AgentConfig): void {
    for (const modelConfig of config.models) {
        const { name, properties } = modelConfig;

        switch (modelConfig.brand) {
            case "openai": {
                if (!properties.apiKey) {
                    logger.warn(`Missing API key for OpenAI model: ${name}. Skipping registration.`);
                    continue;
                }
                logger.info(`Registering OpenAI model: ${name}`);
                modelRegistry.registerModel(name, new OpenAIModel(name, properties.apiKey));
                break;
            }
            case "gemini": {
                if (!properties.apiKey) {
                    logger.warn(`Missing API key for Gemini model: ${name}. Skipping registration.`);
                    continue;
                }
                logger.info(`Registering Gemini model: ${name}`);
                modelRegistry.registerModel(name, new GeminiModel(name, properties.apiKey));
                break;
            }
            case "anthropic": {
                if (!properties.apiKey) {
                    logger.warn(`Missing API key for Anthropic model: ${name}. Skipping registration.`);
                    continue;
                }
                logger.info(`Registering Anthropic model: ${name}`);
                modelRegistry.registerModel(name, new AnthropicModel(name, properties.apiKey, properties.maxTokens));
                break;
            }
            case "self_hosted": {
                logger.info(`Registering self-hosted model: ${name} with base URL: ${properties.baseUrl}`);
                modelRegistry.registerModel(name, new SelfHostedModel(properties.baseUrl, name, properties.apiKey));
                break;
            }
        }
    }
}

// ─── Skill Repository Registration ──────────────────────────────────

function registerSkillRepositories(config: AgentConfig): void {
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

function registerToolProviders(config: AgentConfig): void {
    for (const providerConfig of config.toolProviders) {
        if (providerConfig.type === "openapi") {
            const openApiProvider = new OpenAPIToolProvider(providerConfig);
            toolProviderRegistry.registerToolProvider(openApiProvider);
        }
    }

    // Computer use tool provider (at most one allowed)
    const computerProvider = createComputerUseToolProvider(config.toolProviders);
    if (computerProvider) {
        toolProviderRegistry.registerToolProvider(computerProvider);
    }
}

// ─── Bootstrap ──────────────────────────────────────────────────────

export async function bootstrap(): Promise<Agent> {
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

    return new Agent(
        "agent",
        defaultModel,
        skillRepositoryRegistry.getAllSkillRepositories(),
        toolProviderRegistry.getAllToolProviders()
    );
}
