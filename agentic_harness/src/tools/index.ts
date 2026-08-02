import { loadConfigIfAvailable } from "@/config/config"
import { registerOpenAPIToolProviders } from "./openapi"

export * from "./openapi"

const config = await loadConfigIfAvailable()

if (config) {
    registerOpenAPIToolProviders(config.toolProviders)
}