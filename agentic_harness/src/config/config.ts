import { z } from 'zod'
import fs from 'fs/promises'
import path from 'path'
import { parse } from 'yaml'

const OpenAIPropertiesSchema = z.object({
    // If not provided in YAML, it attempts to read from process.env.OPENAI_API_KEY
    apiKey: z.string().default(() => process.env.OPENAI_API_KEY || ""),
});

const GeminiPropertiesSchema = z.object({
    apiKey: z.string().default(() => process.env.GEMINI_API_KEY || ""),
});

const AnthropicPropertiesSchema = z.object({
    apiKey: z.string().default(() => process.env.ANTHROPIC_API_KEY || ""),
    maxTokens: z.number().default(4096),
});

const SelfHostedPropertiesSchema = z.object({
    baseUrl: z.url(),
    apiKey: z.string().optional(),
});

// model config schema
const ModelConfigSchema = z.discriminatedUnion("brand", [
    z.object({
        name: z.string(),
        brand: z.literal("openai"),
        properties: OpenAIPropertiesSchema,
    }),
    z.object({
        name: z.string(),
        brand: z.literal("gemini"),
        properties: GeminiPropertiesSchema,
    }),
    z.object({
        name: z.string(),
        brand: z.literal("anthropic"),
        properties: AnthropicPropertiesSchema,
    }),
    z.object({
        name: z.string(),
        brand: z.literal("self_hosted"),
        properties: SelfHostedPropertiesSchema,
    }),
]);

// agent schema
export const AgentConfigSchema = z.object({
    models: z.array(ModelConfigSchema),
});

// Extract the infered TypeScript types directly from the Zod schemas
// This replaces your manual interface declarations!
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
export type ModelConfig = z.infer<typeof ModelConfigSchema>;

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
