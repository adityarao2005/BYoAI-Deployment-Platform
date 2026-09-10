import type { ToolProviderConfig } from "@/config/tool_config";
import { ToolProvider, toolProviderRegistry } from "../tools";
import { LocalComputerUseToolProvider } from "./local_provider";
import { RemoteComputerUseToolProvider } from "./remote_provider";

export function createComputerUseToolProvider(config: ToolProviderConfig[]): ToolProvider | null {
    const providers = [];

    for (const providerConfig of config) {
        if (providerConfig.type === "computer") {
            providers.push(providerConfig);
        }
    }

    if (providers.length === 0) return null;

    if (providers.length > 1) {
        throw new Error(
            `There should only be 1 computer use tool provider declared, currently these are the declared computer tool providers: ${providers}`
        );
    }

    const providerConfig = providers[0];
    if (!providerConfig) return null;

    const providerType = providerConfig.provider.type;
    switch (providerType) {
        case "local":
            return new LocalComputerUseToolProvider(providerConfig.provider);
        case "remote":
            return new RemoteComputerUseToolProvider(providerConfig.provider);
        default:
            throw new Error(`Unknown type provided: ${providerType}`);
    }
}
