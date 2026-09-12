import z from "zod";


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
export const ModelConfigSchema = z.discriminatedUnion("brand", [
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

export type ModelConfig = z.infer<typeof ModelConfigSchema>;