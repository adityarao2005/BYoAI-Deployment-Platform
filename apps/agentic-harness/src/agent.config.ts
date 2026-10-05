import {
    ModelConfigSchema,
    SkillRepositoryConfigSchema,
    ToolProviderConfigSchema,
} from "@byo-ai-agent-platform/core/config";
import { z } from "zod";

export const AgentSecuritySchema = z.object({
    jwksUri: z.string().refine((val) => {
        try {
            const u = new URL(val);
            return u.protocol === "http:" || u.protocol === "https:";
        } catch {
            return false;
        }
    }, { message: "jwksUri must be a valid HTTP or HTTPS URL" }),
    alg: z.array(z.enum(['RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512', 'ES256', 'ES384', 'ES512', 'EdDSA'])),
    verify: z.object({
        iss: z.string().optional(),
        nbf: z.boolean().optional().default(true),
        exp: z.boolean().optional().default(true),
        iat: z.boolean().optional().default(true),
        aud: z.union([z.string(), z.array(z.string())]).optional()
    }).optional(),
    adminRoles: z.array(z.string()).optional()
})

export type AgentSecurity = z.infer<typeof AgentSecuritySchema> 

export const RuleEntrySchema = z.union([
    z.string(),
    z.object({
        file: z.string(),
    }),
]);

export type RuleEntry = z.infer<typeof RuleEntrySchema>;

/**
 * Zod schema defining messaging configuration in `agent.yaml`.
 * Can be omitted or set to "in_memory", or configured with a dynamic package and properties.
 */
export const AgentMessagingConfigSchema = z.union([
    z.literal("in_memory"),
    z.object({
        package: z.string().min(1),
        properties: z.union([
            z.record(z.string(), z.any()),
            z.array(z.string()),
        ]).optional(),
    }),
]).optional().default("in_memory");

export type AgentMessagingConfig = z.infer<typeof AgentMessagingConfigSchema>;

/**
 * Normalizes properties from either an array of KEY=VALUE strings
 * or a dictionary object into a unified Record<string, any>.
 */
export function normalizeProperties(
    properties?: Record<string, any> | string[],
): Record<string, any> {
    if (!properties) {
        return {};
    }
    if (Array.isArray(properties)) {
        const result: Record<string, any> = {};
        for (const item of properties) {
            const eqIndex = item.indexOf("=");
            if (eqIndex !== -1) {
                const key = item.slice(0, eqIndex).trim();
                const value = item.slice(eqIndex + 1).trim();
                result[key] = value;
            } else {
                result[item.trim()] = true;
            }
        }
        return result;
    }
    return { ...properties };
}

export const normalizeMessagingProperties = normalizeProperties;
export const normalizePersistenceProperties = normalizeProperties;

/**
 * Zod schema defining single store persistence configuration.
 */
export const SingleStoreConfigSchema = z.union([
    z.literal("in_memory"),
    z.literal("json_files"),
    z.literal("json_file"),
    z.literal("json"),
    z.literal("memory"),
    z.object({
        provider: z.string().optional(),
        package: z.string().optional(),
        properties: z.union([
            z.record(z.string(), z.any()),
            z.array(z.string()),
        ]).optional(),
    }),
]);

export type SingleStoreConfig = z.infer<typeof SingleStoreConfigSchema>;

/**
 * Zod schema defining persistence configuration in `agent.yaml`.
 */
export const PersistenceConfigSchema = z.union([
    z.literal("in_memory"),
    z.literal("json_files"),
    z.literal("json_file"),
    z.literal("json"),
    z.literal("memory"),
    z.object({
        chatMemory: SingleStoreConfigSchema.optional(),
        chatHistory: SingleStoreConfigSchema.optional(),
        tokenStore: SingleStoreConfigSchema.optional(),
        userToken: SingleStoreConfigSchema.optional(),
        computerStore: SingleStoreConfigSchema.optional(),
        computerLifecycle: SingleStoreConfigSchema.optional(),
    }),
]).optional().default("in_memory");

export type PersistenceConfig = z.infer<typeof PersistenceConfigSchema>;

export interface NormalizedStoreConfig {
    type: "in_memory" | "json_files" | "dynamic";
    provider?: string;
    properties: Record<string, any>;
}

export interface NormalizedPersistenceConfig {
    chatMemory: NormalizedStoreConfig;
    tokenStore: NormalizedStoreConfig;
    computerStore: NormalizedStoreConfig;
}

export function normalizeSingleStoreConfig(
    config?: SingleStoreConfig | NormalizedStoreConfig,
): NormalizedStoreConfig {
    if (!config || config === "in_memory" || config === "memory") {
        return { type: "in_memory", properties: {} };
    }
    if (config === "json_files" || config === "json_file" || config === "json") {
        return { type: "json_files", properties: {} };
    }
    if (typeof config === "object" && "type" in config) {
        return {
            type: config.type,
            provider: config.provider,
            properties: normalizeProperties(config.properties),
        };
    }
    const providerName = config.provider ?? config.package;
    const properties = normalizeProperties(config.properties);

    if (
        !providerName ||
        providerName === "in_memory" ||
        providerName === "memory"
    ) {
        return { type: "in_memory", properties };
    }
    if (
        providerName === "json_files" ||
        providerName === "json_file" ||
        providerName === "json"
    ) {
        return { type: "json_files", properties };
    }
    return {
        type: "dynamic",
        provider: providerName,
        properties,
    };
}

export function normalizePersistenceConfig(
    config?: PersistenceConfig,
): NormalizedPersistenceConfig {
    if (!config || config === "in_memory" || config === "memory") {
        return {
            chatMemory: { type: "in_memory", properties: {} },
            tokenStore: { type: "in_memory", properties: {} },
            computerStore: { type: "in_memory", properties: {} },
        };
    }
    if (config === "json_files" || config === "json_file" || config === "json") {
        return {
            chatMemory: { type: "json_files", properties: {} },
            tokenStore: { type: "json_files", properties: {} },
            computerStore: { type: "json_files", properties: {} },
        };
    }

    const chatCfg = config.chatMemory ?? config.chatHistory;
    const tokenCfg = config.tokenStore ?? config.userToken;
    const computerCfg = config.computerStore ?? config.computerLifecycle;

    return {
        chatMemory: normalizeSingleStoreConfig(chatCfg),
        tokenStore: normalizeSingleStoreConfig(tokenCfg),
        computerStore: normalizeSingleStoreConfig(computerCfg),
    };
}

/**
 * Zod schema defining the agent configuration file structure (`agent.yaml`).
 */
export const AgentConfigSchema = z.object({
    name: z.string().optional(),
    description: z.string().optional(),
    rules: z.array(RuleEntrySchema).default([]).optional(),
    models: z.array(ModelConfigSchema),
    skillRepositories: z.array(SkillRepositoryConfigSchema).default([]),
    toolProviders: z.array(ToolProviderConfigSchema).optional().default([]),
    security: AgentSecuritySchema,
    messaging: AgentMessagingConfigSchema.default("in_memory").optional(),
    persistence: PersistenceConfigSchema.default("in_memory").optional(),
});

/**
 * Strongly-typed Agent configuration inferred from {@link AgentConfigSchema}.
 */
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
