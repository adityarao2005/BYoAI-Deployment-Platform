import { loadConfigIfAvailable } from "@/config/config"
import { registerOpenAPIToolProviders } from "./openapi"
import { registerComputerUseToolProvider } from "./computer_use"

const config = await loadConfigIfAvailable()

if (config) {
    registerOpenAPIToolProviders(config.toolProviders)
    registerComputerUseToolProvider(config.toolProviders)
}