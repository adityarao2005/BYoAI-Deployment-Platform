import { OpenAPIToolProviderConfig, ToolProviderConfig } from "@/config/tool_config";
import { Tool, ToolProvider, toolProviderRegistry } from "../tools";
import { parseSpecURL } from "./parser";
import { buildToolsFromSpec } from "./builder";

export class OpenAPIToolProvider implements ToolProvider {
    config: OpenAPIToolProviderConfig;
    private cachedTools: Tool[] | null = null;

    constructor(config: OpenAPIToolProviderConfig) {
        this.config = config;
    }

    private async loadTools(): Promise<Tool[]> {
        if (!this.cachedTools) {
            const doc = (await parseSpecURL(this.config.specUrl)) as Record<string, any>;
            this.cachedTools = buildToolsFromSpec(doc, this.config);
        }
        return this.cachedTools;
    }

    async getToolByName(name: string): Promise<Tool | null> {
        const tools = await this.loadTools();
        return tools.find(tool => tool.name === name) || null;
    }

    async getAllTools(): Promise<Tool[]> {
        return this.loadTools();
    }
}

export function registerOpenAPIToolProviders(config: ToolProviderConfig[]) {
    for (const providerConfig of config) {
        if (providerConfig.type === "openapi") {
            const openApiProvider = new OpenAPIToolProvider(providerConfig);
            toolProviderRegistry.registerToolProvider(openApiProvider);
        }
    }
}
