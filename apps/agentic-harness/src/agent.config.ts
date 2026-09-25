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

/**
 * Zod schema defining the agent configuration file structure (`agent.yaml`).
 */
export const AgentConfigSchema = z.object({
    name: z.string().optional(),
    description: z.string().optional(),
    models: z.array(ModelConfigSchema),
    skillRepositories: z.array(SkillRepositoryConfigSchema).default([]),
    toolProviders: z.array(ToolProviderConfigSchema).optional().default([]),
    security: AgentSecuritySchema
});

/**
 * Strongly-typed Agent configuration inferred from {@link AgentConfigSchema}.
 */
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
