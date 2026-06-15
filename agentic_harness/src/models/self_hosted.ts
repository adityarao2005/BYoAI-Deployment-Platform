import OpenAI from "openai";
import { Message, modelRegistry } from "./models";
import { logger } from "@/logger";

export class SelfHostedModel {
    private client: OpenAI

    constructor(baseURL: string, apiKey?: string) {
        this.client = new OpenAI({
            baseURL,
            apiKey: apiKey ?? "local-api-key",
        });
    }

    async execute(messages: Message[]): Promise<Message> {

        // send the messages to the self-hosted model and get the response
        const response = await this.client.responses.create({
            input: messages.map((message) => ({
                role: message.role,
                content: message.content,
            }))
        })

        // log the token usage for the self-hosted model response
        logger.info(`Input tokens: ${response.usage?.input_tokens}`);
        logger.info(`Output tokens: ${response.usage?.output_tokens}`);

        // go through each output from the self-hosted model response and find the first message output
        let message: string = ""
        for (const output of response.output) {
            logger.info(`Output: ${JSON.stringify(output)}`);

            if (output.type === "message") {
                const messageResponse = output.content[0];

                if (messageResponse?.type === "output_text") {
                    message = messageResponse.text;
                } else {
                    throw new Error("Invalid response format from self-hosted model: expected output_text type in message content.");
                }
            }
        }


        // return the message output from the self-hosted model response, if we found one, otherwise throw an error
        if (response.output.length) {
            return {
                content: message,
                role: "assistant",
                type: "text"
            };
        }

        throw new Error("No valid response received from self-hosted model.");
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
            models.set(modelName, new SelfHostedModel(baseURL, apiKey));
        }
    }

    return models;
})