import { ContentListUnion, GoogleGenAI } from "@google/genai";
import { Model, modelRegistry } from "./models";
import { logger } from "@/logger";
import { ToolArgument } from "@/tools/tool_argument";
import { ModelInput, ModelInteraction, ModelMessageOutput } from "./conversation";
import { type AgentConfig } from "@/config/config";

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
                    ...(msg.thoughtSignature ? { thoughtSignature: msg.thoughtSignature } : {}),
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
                        response: normalizeGeminiFunctionResponse(msg.result)
                    }
                }]
            }
        } else {
            throw new Error(`Unknown message type: ${JSON.stringify(msg)}`);
        }
    })
}

export function normalizeGeminiFunctionResponse(result: unknown): Record<string, unknown> {
    if (result === undefined) {
        return {
            result: null
        };
    }

    if (result !== null && typeof result === "object" && !Array.isArray(result)) {
        return JSON.parse(JSON.stringify(result));
    }

    return {
        result: JSON.parse(JSON.stringify(result))
    };
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

        logger.info(`Token tokens: ${result.tokenCount}`);

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
                    ...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {}),
                    tool: tool
                })
            }
        }

        return output
    }
}

export function registerGeminiModels(config: AgentConfig) {
    for (const modelConfig of config.models) {
        if (modelConfig.brand !== "gemini") {
            continue;
        }

        const { name, properties } = modelConfig;

        if (!properties.apiKey) {
            logger.warn(`Missing API key for Gemini model: ${name}. Skipping registration.`);
            continue;
        }

        logger.info(`Registering Gemini model: ${name} with API key: ${properties.apiKey ? "provided" : "not provided"} and model name: ${name}`);
        modelRegistry.registerModel(name, new GeminiModel(name, properties.apiKey));
    }
}

