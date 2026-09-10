import { ToolProviderConfig } from "@/config/tool_config";
import { ToolProvider, toolProviderRegistry } from "../tools";
import { LocalComputerUseToolProvider } from "./local_provider";
import { RemoteComputerUseToolProvider } from "./remote_provider";

export function registerComputerUseToolProvider(config: ToolProviderConfig[]) {
    const providers = [];

    for (const providerConfig of config) {
        if (providerConfig.type === "computer") {
            providers.push(providerConfig);
        }
    }

    if (providers.length === 0) return;

    if (providers.length > 1) {
        throw new Error(
            `There should only be 1 computer use tool provider declared, currently these are the declared computer tool providers: ${providers}`
        );
    }

    const providerConfig = providers[0];
    if (!providerConfig) return;

    const providerType = providerConfig.provider.type;
    let toolProvider: ToolProvider;
    switch (providerType) {
        case "local":
            toolProvider = new LocalComputerUseToolProvider(providerConfig.provider);
            toolProviderRegistry.registerToolProvider(toolProvider);
            break;
        case "remote":
            toolProvider = new RemoteComputerUseToolProvider(providerConfig.provider);
            toolProviderRegistry.registerToolProvider(toolProvider);
            break;
        default:
            throw new Error(`Unknown type provided: ${providerType}`);
    }
}
