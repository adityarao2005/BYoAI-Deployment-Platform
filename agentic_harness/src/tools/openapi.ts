import { OpenAPIToolProviderConfig, ToolProviderConfig } from "@/config/tool_config";
import { Tool, ToolProvider, toolProviderRegistry } from "./tools";
import { parse } from "yaml";
import RefParser from "@apidevtools/json-schema-ref-parser";
import { upgrade } from "@scalar/openapi-upgrader";

export async function normalizeOpenAPIDocument(rawParsed: unknown): Promise<object> {
    if (!rawParsed || typeof rawParsed !== "object") {
        throw new Error("Invalid spec format: Response did not resolve to a valid JSON/YAML object.");
    }

    // openapi document
    const document = upgrade(rawParsed as any, "3.1");

    // 4. Resolve/Inline all $ref pointers using RefParser
    return RefParser.dereference(document);
}

export async function parseSpecURL(specURL: string): Promise<object> {
    // Parse the OpenAPI spec URL and return the parsed spec
    const response = await fetch(specURL, {
        method: "GET",
        headers: {
            // Ask nicely for JSON or YAML, but accept anything text-based
            Accept: "application/json, application/x-yaml, text/yaml, text/plain, */*",
        },
    })

    // read raw text and parse it as YAML, since OpenAPI specs can be in either JSON or YAML format
    const text = await response.text();
    // 3. Parse string into JS Object (js-yaml handles JSON & YAML identically)
    let rawParsed: unknown;
    try {
        rawParsed = parse(text);
    } catch (err) {
        throw new Error(`Failed to parse response body as valid JSON or YAML: ${err}`);
    }

    return normalizeOpenAPIDocument(rawParsed);
}

export class OpenAPIToolProvider implements ToolProvider {
    config: OpenAPIToolProviderConfig;

    constructor(config: OpenAPIToolProviderConfig) {
        this.config = config;
    }

    async getToolByName(name: string): Promise<Tool | null> {
        throw new Error("Method not implemented.");
    }

    async getAllTools(): Promise<Tool[]> {
        throw new Error("Method not implemented.");
    }
}


export function registerOpenAPIToolProviders(config: ToolProviderConfig[]) {
    for (const providerConfig of config) {
        if (providerConfig.type === "openapi") {
            const openApiProvider = new OpenAPIToolProvider(providerConfig);

            // Register the OpenAPIToolProvider with the ToolProviderRegistry
            toolProviderRegistry.registerToolProvider(openApiProvider);
        }
    }
}