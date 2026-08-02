import { OpenAPIToolProviderConfig, ToolProviderConfig } from "@/config/tool_config";
import { Tool, ToolProvider, toolProviderRegistry } from "./tools";

export class OpenAPIToolProvider implements ToolProvider {
    config: OpenAPIToolProviderConfig;

    constructor(config: OpenAPIToolProviderConfig) {
        this.config = config;
    }

    getToolByName(name: string): Promise<Tool | null> {
        throw new Error("Method not implemented.");
    }

    getAllTools(): Promise<Tool[]> {
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