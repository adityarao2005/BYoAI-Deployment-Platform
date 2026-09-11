import { LocalComputerProvider } from "@/computer/local_provider";
import { RemoteComputerProvider } from "@/computer/remote_provider";
import type { ComputerProvider } from "@/computer/computer";
import type {
    ComputerUseToolProviderConfig,
    LocalComputerUseToolProviderConfig,
    RemoteComputerUseToolProviderConfig,
} from "@/config/tool_config";
import { ComputerUseToolProvider } from "./provider";

export type ComputerProviderConfig =
    | ComputerUseToolProviderConfig
    | LocalComputerUseToolProviderConfig
    | RemoteComputerUseToolProviderConfig;

/**
 * Creates a ComputerProvider instance (local or remote) based on the supplied configuration.
 */
export function createComputerProvider(
    config: ComputerProviderConfig
): ComputerProvider {
    const providerConfig = "provider" in config ? config.provider : config;

    switch (providerConfig.type) {
        case "local":
            return new LocalComputerProvider(providerConfig);
        case "remote":
            return new RemoteComputerProvider(providerConfig);
        default:
            throw new Error(`Unknown computer provider type: ${(providerConfig as any).type}`);
    }
}

/**
 * Factory method to create a ComputerUseToolProvider by first instantiating
 * the appropriate ComputerProvider and passing it into ComputerUseToolProvider.
 */
export function createComputerUseToolProvider(
    config: ComputerProviderConfig
): ComputerUseToolProvider {
    const computerProvider = createComputerProvider(config);
    return new ComputerUseToolProvider(computerProvider);
}
