import z from "zod";

export const BaseToolProviderConfigSchema = z.object({
    name: z.string()
})

export const OpenAPIToolProviderConfigSchema = BaseToolProviderConfigSchema.extend({
    type: z.literal("openapi"),
    specUrl: z.string(),
    securityVariables: z.discriminatedUnion("type", [
        z.object({
            type: z.literal("apiKey"),
            key: z.string(),
            name: z.string().default("X-API-Key"),
            location: z.enum(["header", "query", "cookie"]).default("header")
        }),
        z.object({
            type: z.literal("bearerToken"),
            token: z.string()
        }),
        z.object({
            type: z.literal("basicAuth"),
            username: z.string(),
            password: z.string(),
            location: z.enum(["header", "authority"]).default("header")
        }),
        z.object({
            type: z.literal("custom"),
            headers: z.record(z.string(), z.string()).default({}),
            queryParams: z.record(z.string(), z.string()).default({}),
            pathParams: z.record(z.string(), z.string()).default({}),
            urlAuthority: z.object({
                user: z.string().optional(),
                password: z.string().optional()
            }).optional(),
        }),

        // TODO: implement OAuth2 support in the future when we make this an actual server-side component that can handle the OAuth2 flow. For now, we just define the schema for it.
        z.object({
            type: z.literal("oauth2")
        })
    ])
})

export type OpenAPIToolProviderConfig = z.infer<typeof OpenAPIToolProviderConfigSchema>;

export const ToolProviderConfigSchema = z.discriminatedUnion("type", [
    OpenAPIToolProviderConfigSchema
])

export type ToolProviderConfig = z.infer<typeof ToolProviderConfigSchema>;