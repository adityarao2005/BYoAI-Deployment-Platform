import OpenAI from "openai";
import { Message, modelRegistry } from "./models";
import { logger } from "@/logger";

export class OpenAIModel {
    private client: OpenAI
    private modelName: string

    constructor(modelName: string, apiKey: string) {
        this.modelName = modelName;
        this.client = new OpenAI({
            apiKey,
        });
    }

    async execute(messages: Message[]): Promise<Message> {

        const response = await this.client.responses.create({
            model: this.modelName,
            input: messages.map((message) => ({
                role: message.role,
                content: [{
                    type: "input_text",
                    text: message.content,
                }],
            })),
        });

        logger.info(`Input tokens: ${response.usage?.input_tokens}`);
        logger.info(`Output tokens: ${response.usage?.output_tokens}`);
        logger.info(`Total tokens: ${response.usage?.total_tokens}`);
        logger.info(`Response status: ${response.status ?? "unknown"}`);

        const content = response.output_text?.trim();

        if (!content) {
            throw new Error("No text output received from OpenAI model response.");
        }

        return {
            content,
            role: "assistant",
            type: "text"
        };
    }
}

// OpenAI models are registered with the model registry, but only if the environment variable is set
modelRegistry.registerModels((env) => {

    // environment variable prefixes
    const OPENAI_MODEL_API_KEY_PREFIX = "OPENAI_MODEL_API_KEY_";
    const OPENAI_MODEL_NAME_PREFIX = "OPENAI_MODEL_NAME_";

    const models = new Map<string, OpenAIModel>();

    for (const key in env) {
        if (key.startsWith(OPENAI_MODEL_API_KEY_PREFIX) && env[key]) {

            // get the model name from the environment variable
            const modelId = key.substring(OPENAI_MODEL_API_KEY_PREFIX.length).toLowerCase();

            if (modelId.length === 0) {
                logger.warn(`Environment variable ${key} is missing a model ID suffix, skipping registration of this OpenAI model.`);
                continue;
            }

            const apiKey = env[key];

            // look for a corresponding API key environment variable
            if (!apiKey) {
                logger.warn(`Invalid API Key for OpenAI model: ${modelId}. Skipping registration.`);
                continue;
            }

            const modelNameEnvVar = `${OPENAI_MODEL_NAME_PREFIX}${modelId.toUpperCase()}`;
            const modelName = env[modelNameEnvVar];

            if (!modelName) {
                logger.warn(`Missing environment variable ${modelNameEnvVar} for OpenAI model: ${modelId}. Skipping registration.`);
                continue;
            }

            // log the registration of the OpenAI model, but don't log the actual API key for security reasons
            logger.info(`Registering OpenAI model: ${modelId} with API key: ${apiKey ? "provided" : "not provided"} and model name: ${modelName}`);
            models.set(modelName, new OpenAIModel(modelName, apiKey));
        }
    }

    return models;
})