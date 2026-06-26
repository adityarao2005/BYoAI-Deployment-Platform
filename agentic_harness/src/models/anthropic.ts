import Anthropic from "@anthropic-ai/sdk";
import { Message, Model, ModelMessageInput, modelRegistry } from "./models";
import { logger } from "@/logger";


export class AnthropicModel implements Model {
    private client: Anthropic
    private modelName: string
    private max_tokens: number

    constructor(modelName: string, apiKey: string, max_tokens: number = 1024) {
        this.modelName = modelName;
        this.client = new Anthropic({ apiKey });
        this.max_tokens = max_tokens;
    }

    async execute(input: ModelMessageInput): Promise<Message> {
        const response = await this.client.messages.create({
            model: this.modelName,
            max_tokens: this.max_tokens,
            system: input.history.filter((message) => message.role === "system").map((message) => ({
                type: "text",
                text: message.content,
            })),
            messages: input.history.map((message) => ({
                role: message.role === "user" ? "user" : "assistant",
                content: message.content,
            }))
        });


        if (response.content.length <= 0) {
            throw new Error("No text output received from Anthropic model response.");
        }

        return {
            content: response.content[0]?.type === "text" ? response.content[0].text : "",
            role: "assistant",
            type: "text"
        }
    }
}

modelRegistry.registerModels((env) => {

    // environment variable prefixes
    const ANTHROPIC_MODEL_API_KEY_PREFIX = "ANTHROPIC_MODEL_API_KEY_";
    const ANTHROPIC_MODEL_NAME_PREFIX = "ANTHROPIC_MODEL_NAME_";
    const ANTHROPIC_MODEL_MAX_TOKENS_PREFIX = "ANTHROPIC_MODEL_MAX_TOKENS_";

    const models = new Map<string, AnthropicModel>();

    for (const key in env) {
        if (key.startsWith(ANTHROPIC_MODEL_API_KEY_PREFIX) && env[key]) {

            // get the model name from the environment variable
            const modelId = key.substring(ANTHROPIC_MODEL_API_KEY_PREFIX.length).toLowerCase();

            if (modelId.length === 0) {
                logger.warn(`Environment variable ${key} is missing a model ID suffix, skipping registration of this Anthropic model.`);
                continue;
            }

            const apiKey = env[key];

            // look for a corresponding API key environment variable
            if (!apiKey) {
                logger.warn(`Invalid API Key for Anthropic model: ${modelId}. Skipping registration.`);
                continue;
            }

            const modelNameEnvVar = `${ANTHROPIC_MODEL_NAME_PREFIX}${modelId.toUpperCase()}`;
            const modelName = env[modelNameEnvVar];

            if (!modelName) {
                logger.warn(`Missing environment variable ${modelNameEnvVar} for Anthropic model: ${modelId}. Skipping registration.`);
                continue;
            }

            const maxTokensEnvVar = `${ANTHROPIC_MODEL_MAX_TOKENS_PREFIX}${modelId.toUpperCase()}`;
            const maxTokensStr = env[maxTokensEnvVar];
            let maxTokens: number = 1024; // default value

            if (maxTokensStr) {
                const parsedMaxTokens = parseInt(maxTokensStr, 10);
                if (!isNaN(parsedMaxTokens) && parsedMaxTokens > 0) {
                    maxTokens = parsedMaxTokens;
                } else {
                    logger.warn(`Invalid value for ${maxTokensEnvVar}: ${maxTokensStr}. Using default max tokens: ${maxTokens}.`);
                }
            }

            // log the registration of the Anthropic model, but don't log the actual API key for security reasons
            logger.info(`Registering Anthropic model: ${modelId} with API key: ${apiKey ? "provided" : "not provided"} and model name: ${modelName}`);
            models.set(modelId, new AnthropicModel(modelName, apiKey, maxTokens));
        }
    }

    return models;
})