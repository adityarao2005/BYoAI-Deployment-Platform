import OpenAI from "openai";
import { Message, modelRegistry } from "./models";
import { logger } from "@/logger";

export class SelfHostedModel {
    private client: OpenAI
    private modelName: string

    constructor(baseURL: string, modelName: string, apiKey?: string) {
        this.modelName = modelName;
        this.client = new OpenAI({
            baseURL,
            apiKey: apiKey ?? "local-api-key",
        });
    }

    async execute(messages: Message[]): Promise<Message> {

        const response = await this.client.chat.completions.create({
            model: this.modelName,
            messages: messages.map((message) => ({
                role: message.role,
                content: message.content,
            }))
        })

        logger.info(`Input tokens: ${response.usage?.prompt_tokens}`);
        logger.info(`Output tokens: ${response.usage?.completion_tokens}`);
        logger.info(`Total tokens: ${response.usage?.total_tokens}`);
        logger.info(`Model response choices: ${response.choices.length}`);

        response.choices.forEach((choice, index) => {
            logger.info(`Choice ${index + 1}: ${choice.message?.content}. Finish reason: ${choice.finish_reason}`);
        });

        if (response.choices.length === 0) {
            throw new Error("No response choices received from self-hosted model.");
        }

        const content = response.choices[0]!.message.content!;

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
    const SELF_HOSTED_MODEL_BASE_URL_PREFIX = "SELF_HOSTED_MODEL_BASE_URL_";
    const SELF_HOSTED_MODEL_API_KEY_PREFIX = "SELF_HOSTED_MODEL_API_KEY_";

    const models = new Map<string, SelfHostedModel>();

    for (const key in env) {
        if (key.startsWith(SELF_HOSTED_MODEL_BASE_URL_PREFIX) && env[key]) {

            // get the model name from the environment variable
            const modelName = key.substring(SELF_HOSTED_MODEL_BASE_URL_PREFIX.length).toLowerCase();

            if (modelName.length === 0) {
                logger.warn(`Environment variable ${key} is missing a model name suffix, skipping registration of this self hosted model.`);
                continue;
            }

            const baseURL = env[key];

            if (!baseURL || !URL.canParse(baseURL)) {
                logger.warn(`Invalid base URL for self-hosted model: ${modelName}. Skipping registration.`);
                continue;
            }

            // look for a corresponding API key environment variable
            const apiKeyEnvVar = SELF_HOSTED_MODEL_API_KEY_PREFIX + modelName.toUpperCase();
            const apiKey = env[apiKeyEnvVar];

            // it doesn't matter if we get an api-key, api keys are optional

            // log the registration of the self-hosted model, but don't log the actual API key for security reasons
            logger.info(`Registering self-hosted model: ${modelName} with base URL: ${baseURL} and API key: ${apiKey ? "provided" : "not provided"}`);
            models.set(modelName, new SelfHostedModel(baseURL, modelName, apiKey));
        }
    }

    return models;
})