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
            throw new Error("No text output received from self-hosted model response.");
        }

        return {
            content,
            role: "assistant",
            type: "text"
        };
    }
}

// Self hosted models are registered with the model registry, but only if the environment variable is set
modelRegistry.registerModels((env) => {

    // environment variable prefixes
    const SELF_HOSTED_MODEL_API_KEY_PREFIX = "SELF_HOSTED_MODEL_API_KEY_";

    const models = new Map<string, OpenAIModel>();

    for (const key in env) {
        if (key.startsWith(SELF_HOSTED_MODEL_API_KEY_PREFIX) && env[key]) {

            // get the model name from the environment variable
            const modelName = key.substring(SELF_HOSTED_MODEL_API_KEY_PREFIX.length).toLowerCase();

            if (modelName.length === 0) {
                logger.warn(`Environment variable ${key} is missing a model name suffix, skipping registration of this self hosted model.`);
                continue;
            }

            const apiKey = env[key];

            // look for a corresponding API key environment variable
            if (!apiKey) {
                logger.warn(`Invalid API Key for self-hosted model: ${modelName}. Skipping registration.`);
                continue;
            }

            // log the registration of the self-hosted model, but don't log the actual API key for security reasons
            logger.info(`Registering self-hosted model: ${modelName} with API key: ${apiKey ? "provided" : "not provided"}`);
            models.set(modelName, new OpenAIModel(modelName, apiKey));
        }
    }

    return models;
})