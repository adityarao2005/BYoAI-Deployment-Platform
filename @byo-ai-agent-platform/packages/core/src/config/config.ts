import { z } from 'zod'
import { ModelConfigSchema } from './model_config';
import { SkillRepositoryConfigSchema } from './skill_config';
import { ToolProviderConfigSchema } from './tool_config';



// agent schema
export const AgentConfigSchema = z.object({
    models: z.array(ModelConfigSchema),
    skillRepositories: z.array(SkillRepositoryConfigSchema).default([]),
    toolProviders: z.array(ToolProviderConfigSchema).optional().default([])
});

// Extract the infered TypeScript types directly from the Zod schemas
// This replaces your manual interface declarations!
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
