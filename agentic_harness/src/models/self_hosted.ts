import OpenAI from "openai";
import { Model, modelRegistry } from "./models";
import { logger } from "@/logger";
import { ModelInput, ModelInteraction, ModelMessageOutput } from "./conversation";
import { ChatCompletionAssistantMessageParam } from "openai/resources";

function toChatCompletionInteraction(message: ModelInteraction[]): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
    return message.map((msg) => {
        if (msg.type === "message") {
            return {
                role: msg.role,
                content: msg.content,
            };
        } else if (msg.type === "tool_call") {
            return {
                role: "assistant",
                tool_calls: [{
                    id: msg.id,
                    type: "function",
                    function: {
                        arguments: JSON.stringify(msg.arguments),
                        name: msg.tool.name
                    },
                }],
            } as ChatCompletionAssistantMessageParam;
        } else if (msg.type === "tool_response") {
            return {
                role: "tool",
                content: JSON.stringify(msg.result),
                tool_call_id: msg.id,
                name: msg.tool.name,
            };
        } else {
            throw new Error(`Unknown message type: ${msg}`);
        }
    })
}

export class SelfHostedModel implements Model {

    private client: OpenAI
    private modelName: string

    constructor(baseURL: string, modelName: string, apiKey?: string) {
        this.modelName = modelName;
        this.client = new OpenAI({
            baseURL,
            apiKey: apiKey ?? "local-api-key",
        });
    }

    async execute(input: ModelInput): Promise<ModelMessageOutput[]> {

        const response = await this.client.chat.completions.create({
            model: this.modelName,
            messages: [
                {
                    role: "system",
                    content: input.systemPrompt ?? "You are a helpful assistant."
                },
                ...toChatCompletionInteraction(input.history)
            ],
            tools: input.tools.map((tool) => ({
                type: "function",
                function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.inputSchema
                }
            })),

        })

        logger.info(`Total tokens: ${response.usage?.total_tokens}`);

        response.choices.forEach((choice, index) => {
            logger.info(`Choice ${index + 1}: ${choice.message?.content}. Finish reason: ${choice.finish_reason}`);
        });

        if (response.choices.length === 0) {
            throw new Error("No response choices received from self-hosted model.");
        }

        const message = response.choices[0]!.message;

        const outputs: ModelMessageOutput[] = [];

        if (message.content) {
            outputs.push({
                role: "assistant",
                type: "message",
                content: message.content
            });
        }

        if (message.tool_calls && message.tool_calls.length > 0) {
            for (const tool of message.tool_calls) {
                if (tool.type !== "function")
                    continue;

                const toolToUse = input.tools.find(t => t.name === tool.function.name);

                if (!toolToUse) {
                    throw new Error(`Tool not found for function call: ${tool.function.name}`);
                }

                outputs.push({
                    type: "tool_call",
                    arguments: JSON.parse(tool.function.arguments),
                    id: tool.id,
                    tool: toolToUse
                });
            }
        }

        return outputs;
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