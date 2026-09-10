export * from "./models"
import { loadConfigIfAvailable } from "@/config/config"
import { registerOpenAIModels } from "./openai"
import { registerGeminiModels } from "./gemini"
import { registerAnthropicModels } from "./anthropic"
import { registerSelfHostedModels } from "./self_hosted"

const config = await loadConfigIfAvailable()

if (config) {
    registerOpenAIModels(config)
    registerGeminiModels(config)
    registerAnthropicModels(config)
    registerSelfHostedModels(config)
}