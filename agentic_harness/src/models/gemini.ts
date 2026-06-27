import { GoogleGenAI } from "@google/genai";
import { Message, Model, ModelMessageInput, modelRegistry } from "./models";
import { logger } from "@/logger";
import { ToolArgument } from "@/tools/tool_argument";

export function formatSchemaForGemini(arg: ToolArgument): any {
    // Deep clone to prevent mutating your core registry state
    const clone = JSON.parse(JSON.stringify(arg));

    const convertToUppercase = (obj: any) => {
        if (!obj || typeof obj !== "object") return;

        // Convert the type string to uppercase if it exists
        if (typeof obj.type === "string") {
            obj.type = obj.type.toUpperCase(); // "object" -> "OBJECT", "string" -> "STRING"
        } else if (Array.isArray(obj.type)) {
            // Handle type arrays if applicable e.g., ["string", "null"] -> ["STRING", "NULL"]
            obj.type = obj.type.map((t: string) => t.toUpperCase());
        }

        // Recursively handle nested object properties
        if (obj.properties) {
            for (const key of Object.keys(obj.properties)) {
                convertToUppercase(obj.properties[key]);
            }
        }

        // Recursively handle array items
        if (obj.items) {
            convertToUppercase(obj.items);
        }
    };

    convertToUppercase(clone);
    return clone;
}

export class GeminiModel implements Model {
    private client: GoogleGenAI
    private modelName: string

    constructor(modelName: string, apiKey: string) {
        this.modelName = modelName;
        this.client = new GoogleGenAI({ apiKey });
    }

    async execute(input: ModelMessageInput): Promise<Message> {
        const response = await this.client.models.generateContent({
            model: this.modelName,
            contents: [
                {
                    role: "system",
                    parts: [{ text: input.systemPrompt ?? "You are a helpful assistant." }]
                },
                ...input.history.map((message) => ({
                role: message.role === "user" ? "user" : "model",
                parts: [{ text: message.content }],
            }))],
            config: {
                tools: input.tools.map((tool) => ({
                    functionDeclarations: [{
                        name: tool.name,
                        description: tool.description,
                        parameters: formatSchemaForGemini(tool.inputSchema),
                    }]
                }))
            }
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
            models.set(modelId, new GeminiModel(modelName, apiKey));
        }
    }

    return models;
})

