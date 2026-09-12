import type { ComputerUseToolProviderConfig } from "@/config";
import type { ComputerProvider } from "./computer";
import { LocalComputerProvider } from "./local_provider";
import { RemoteComputerProvider } from "./remote_provider";

export * from "./computer"
export * from "./local_provider"
export * from "./remote_provider"


/**
 * Creates a ComputerProvider instance (local or remote) based on the supplied configuration.
 */
export function createComputerProvider(
    config: ComputerUseToolProviderConfig
): ComputerProvider {
    switch (config.provider.type) {
        case "local":
            return new LocalComputerProvider(config.provider);
        case "remote":
            return new RemoteComputerProvider(config.provider);
    }
}