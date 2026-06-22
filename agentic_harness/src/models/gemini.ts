import { GoogleGenAI } from "@google/genai";
import { Message, modelRegistry } from "./models";
import { logger } from "@/logger";

export class GeminiModel {
    private client: GoogleGenAI
    private modelName: string

    constructor(modelName: string, apiKey: string) {
        this.modelName = modelName;
        this.client = new GoogleGenAI({ apiKey });
    }

    async execute(messages: Message[]): Promise<Message> {
        const response = await this.client.models.generateContent({
            model: this.modelName,
            contents: messages.map((message) => ({
                role: message.role === "user" ? "user" : "model",
                parts: [{ text: message.content }],
            }))
        });

        const result = response;
        logger.info(`Response status: ${result.candidates?.[0]?.finishReason ?? "unknown"}`);

        const content = result.text?.trim();

        if (!content) {
            throw new Error("No text output received from Gemini model response.");
        }

        return {
            content,
            role: "assistant",
            type: "text"
        };
    }
}

// Gemini models are registered with the model registry, but only if the environment variable is set
modelRegistry.registerModels((env) => {

    // environment variable prefixes
    const GEMINI_MODEL_API_KEY_PREFIX = "GEMINI_MODEL_API_KEY_";
    const GEMINI_MODEL_NAME_PREFIX = "GEMINI_MODEL_NAME_";

    const models = new Map<string, GeminiModel>();

    for (const key in env) {
        if (key.startsWith(GEMINI_MODEL_API_KEY_PREFIX) && env[key]) {

            // get the model name from the environment variable
            const modelId = key.substring(GEMINI_MODEL_API_KEY_PREFIX.length).toLowerCase();

            if (modelId.length === 0) {
                logger.warn(`Environment variable ${key} is missing a model ID suffix, skipping registration of this Gemini model.`);
                continue;
            }

            const apiKey = env[key];

            // look for a corresponding API key environment variable
            if (!apiKey) {
                logger.warn(`Invalid API Key for Gemini model: ${modelId}. Skipping registration.`);
                continue;
            }

            const modelNameEnvVar = `${GEMINI_MODEL_NAME_PREFIX}${modelId.toUpperCase()}`;
            const modelName = env[modelNameEnvVar];

            if (!modelName) {
                logger.warn(`Missing environment variable ${modelNameEnvVar} for Gemini model: ${modelId}. Skipping registration.`);
                continue;
            }

            // log the registration of the Gemini model, but don't log the actual API key for security reasons
            logger.info(`Registering Gemini model: ${modelId} with API key: ${apiKey ? "provided" : "not provided"} and model name: ${modelName}`);
            models.set(modelName, new GeminiModel(modelName, apiKey));
        }
    }

    return models;
})

