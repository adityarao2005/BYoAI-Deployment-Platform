import { ContentListUnion, GoogleGenAI } from "@google/genai";
import { Model, modelRegistry } from "./models";
import { logger } from "@/logger";
import { ToolArgument } from "@/tools/tool_argument";
import { ModelInput, ModelInteraction, ModelMessageOutput } from "./conversation";

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

function toGeminiInteraction(message: ModelInteraction[]): ContentListUnion {
    return message.map((msg) => {
        if (msg.type === "message") {
            return {
                role: msg.role === "user" ? "user" : "model",
                parts: [{ text: msg.content }]
            }
        } else if (msg.type === "tool_call") {
            return {
                role: "model",
                parts: [{
                    functionCall: {
                        name: msg.tool.name,
                        args: msg.arguments,
                        id: msg.id
                    }
                }]
            }
        } else if (msg.type === "tool_response") {
            return {
                role: "model",
                parts: [{
                    functionResponse: {
                        id: msg.id,
                        name: msg.tool.name,
                        response: JSON.parse(JSON.stringify(msg.result))
                    }
                }]
            }
        } else {
            throw new Error(`Unknown message type: ${JSON.stringify(msg)}`);
        }
    })
}

export class GeminiModel implements Model {
    private client: GoogleGenAI
    private modelName: string

    constructor(modelName: string, apiKey: string) {
        this.modelName = modelName;
        this.client = new GoogleGenAI({ apiKey });
    }

    async execute(input: ModelInput): Promise<ModelMessageOutput[]> {
        const response = await this.client.models.generateContent({
            model: this.modelName,
            contents: toGeminiInteraction(input.history),
            config: {
                systemInstruction: input.systemPrompt ?? "You are a helpful assistant.",
                tools: input.tools.map((tool) => ({
                    functionDeclarations: [{
                        name: tool.name,
                        description: tool.description,
                        parameters: formatSchemaForGemini(tool.inputSchema),
                    }]
                }))
            }
        });

        if (!response.candidates || response.candidates.length == 0) {
            throw new Error("No output received from Gemini model response.");
        }

        const result = response.candidates[0]!;
        logger.info(`Response status: ${result.finishReason ?? "unknown"}`);

        const parts = result.content?.parts

        if (!parts || parts.length == 0) {
            throw new Error("No content parts received from Gemini model response.");
        }

        logger.info(`Token Count: ${result.tokenCount}`);

        const output = [] as ModelMessageOutput[];

        for (const part of parts) {
            if (part.text) {
                output.push({
                    role: "assistant",
                    type: "message",
                    content: part.text
                })
            } else if (part.functionCall) {
                const tool = input.tools.find((t) => t.name === part.functionCall!.name);
                
                if (!tool) {
                    throw new Error(`Tool not found for function call: ${part.functionCall!.name}`);
                }

                output.push({
                    type: "tool_call",
                    arguments: part.functionCall.args!,
                    id: part.functionCall.id!,
                    tool: tool
                })
            }
        }

        return output
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

