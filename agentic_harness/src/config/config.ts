import { z } from 'zod'
import fs from 'fs/promises'
import path from 'path'
import { parse } from 'yaml'
import { ModelConfigSchema } from './model_config';
import { SkillRepositoryConfigSchema } from './skill_config';



// agent schema
export const AgentConfigSchema = z.object({
    models: z.array(ModelConfigSchema),
    skillRepositories: z.array(SkillRepositoryConfigSchema).default([]),
});

// Extract the infered TypeScript types directly from the Zod schemas
// This replaces your manual interface declarations!
export type AgentConfig = z.infer<typeof AgentConfigSchema>;

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
