import OpenAI from "openai";
import { Model, modelRegistry } from "./models";
import { logger } from "@/logger";
import { AssistantMessage, ModelInput, ModelInteraction, ModelMessageOutput, ToolCallRequest } from "./conversation";

function toOpenAIInteraction(message: ModelInteraction[]): OpenAI.Responses.ResponseInput {
    return message.map((msg) => {
        if (msg.type === "message") {
            return {
                role: msg.role,
                content: msg.content,
            };
        } else if (msg.type === "tool_call") {
            return {
                type: "function_call",
                name: msg.tool.name,
                arguments: JSON.stringify(msg.arguments),
                call_id: msg.id
            };
        } else if (msg.type === "tool_response") {
            return {
                type: "function_call_output",
                output: JSON.stringify(msg.result),
                call_id: msg.id
            };
        } else {
            throw new Error(`Unknown message type: ${msg}`);
        }
    })
}

export class OpenAIModel implements Model {
    private client: OpenAI
    private modelName: string

    constructor(modelName: string, apiKey: string) {
        this.modelName = modelName;
        this.client = new OpenAI({
            apiKey,
        });
    }

    async execute(input: ModelInput): Promise<ModelMessageOutput[]> {

        const response = await this.client.responses.create({
            model: this.modelName,
            instructions: input.systemPrompt ?? "You are a helpful assistant.",
            input: toOpenAIInteraction(input.history),
            tools: input.tools.map((tool) => ({
                type: "function",
                name: tool.name,
                description: tool.description,
                parameters: tool.inputSchema,
                strict: true
            }))
        });

        if (response.output.length <= 0) {
            throw new Error("No output received from OpenAI model response.");
        }

        logger.info(`Token Count: ${response.usage!.output_tokens + response.usage!.input_tokens}`);

        const output = [] as ModelMessageOutput[];

        for (const msg of response.output) {
            if (msg.type === "message") {
                // check if the message has content
                if (!msg.content || msg.content.length === 0) {
                    throw new Error("OpenAI response message has no content.");
                }

                // any refusal messages should come first
                const refusal = msg.content.find((c) => c.type === "refusal");
                if (refusal) {
                    logger.warn(`OpenAI model refused to answer: ${refusal.refusal}`);
                    output.push({
                        role: "assistant",
                        type: "message",
                        content: refusal.refusal
                    });
                }

                // return success message
                output.push({
                    role: "assistant",
                    type: "message",
                    content: msg.content.filter(c => c.type === "output_text").flatMap((c) => c.text).join("\n")
                });
            } else if (msg.type === "function_call") {
                const tool = input.tools.find((t) => t.name === msg.name);

                if (!tool) {
                    throw new Error(`OpenAI model requested unknown tool: ${msg.name}`);
                }

                output.push({
                    type: "tool_call",
                    arguments: JSON.parse(msg.arguments),
                    id: msg.call_id,
                    tool: tool
                })
            }
        }
        return output;
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
            models.set(modelId, new OpenAIModel(modelName, apiKey));
        }
    }

    return models;
})