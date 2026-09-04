import { arraySync } from "node:stream/iter";
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

export const ComputerUseToolProviderConfigSchema = z.object({
    type: z.literal("computer"),
    provider: z.discriminatedUnion("type", [
        z.object({
            type: z.literal("local"),
            enableGUIToolsIfAvailable: z.boolean()
        }),
        z.object({
            type: z.literal("remote"),
            // if we want to have at least support for GUI clients even tho our image doesn't have it: this allows
            enableGUIToolsIfAvailable: z.boolean().default(false),
            url: z.string(), // computer controller connectrpc base url
            image: z.string(), // docker image

            // security configuration, either apikey auth or mtls
            security: z.object({
                apiKey: z.string().optional(),
                mtls: z.object({
                    clientCert: z.string()
                }).optional()
            }).optional(),

            // egress - outbound network configuration
            networkRules: z.object({
                allowedHosts: z.union([
                    z.string(), // wildcard support like "*" or "*.example.com"
                    z.array(z.string())]).default("*"),
                deniedHosts: z.union([
                    z.string(), // wildcard support like "*" or "*.example.com"
                    z.array(z.string())]).default([])
            }).optional(),

            // environment variables
            resources: z.object({
                cpu: z.union([
                    z.number().positive(),
                    z.string().regex(/^(\d+(\.\d+)?|\d+m)$/, {
                        message: "Must be a number of cores (e.g., 2, 0.5) or millicores (e.g., 500m)",
                    })]),
                memory: z.string().regex(/^(\d+(?:\.\d+)?)\s*([KMGT]i?B|[KMGT]?)$/i, {
                    message: "Invalid memory format (e.g., '512MB', '4GiB', '2G')",
                }),
            }).optional(),

            // environment
            environment: z.union([
                z.array(z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*=.*$/)),
                z.record(z.string(), z.string())
            ]).transform(val => {
                // if user passed dictonary object, return as-is
                if (!Array.isArray(val)) {
                    return val
                }

                // If the user passed an array of "KEY=VALUE", convert it to a dictionary
                const envMap: Record<string, string> = {};
                for (const item of val) {
                    const index = item.indexOf('=');
                    const key = item.slice(0, index);
                    const value = item.slice(index + 1);
                    envMap[key] = value;
                }
                return envMap;
            }).optional(),

            // env file
            envFile: z.string()
        })
    ])
})

export type ComputerUseToolProviderConfig = z.infer<typeof ComputerUseToolProviderConfigSchema>;

export const ToolProviderConfigSchema = z.discriminatedUnion("type", [
    OpenAPIToolProviderConfigSchema,
    ComputerUseToolProviderConfigSchema,
])

export type ToolProviderConfig = z.infer<typeof ToolProviderConfigSchema>;