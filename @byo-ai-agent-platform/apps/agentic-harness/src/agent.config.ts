import { z } from 'zod'
import { ModelConfigSchema, SkillRepositoryConfigSchema, ToolProviderConfigSchema } from '@byo-ai-agent-platform/core/config';

/**
 * Zod schema defining the agent configuration file structure (`agent.yaml`).
 */
export const AgentConfigSchema = z.object({
    name: z.string().optional(),
    description: z.string().optional(),
    models: z.array(ModelConfigSchema),
    skillRepositories: z.array(SkillRepositoryConfigSchema).default([]),
    toolProviders: z.array(ToolProviderConfigSchema).optional().default([])
});

/**
 * Strongly-typed Agent configuration inferred from {@link AgentConfigSchema}.
 */
export type AgentConfig = z.infer<typeof AgentConfigSchema>;

