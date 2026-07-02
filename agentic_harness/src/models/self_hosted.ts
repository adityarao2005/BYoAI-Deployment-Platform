import OpenAI from "openai";
import { Model, modelRegistry } from "./models";
import { logger } from "@/logger";
import { ModelInput, ModelInteraction, ModelMessageOutput } from "./conversation";
import { ChatCompletionAssistantMessageParam } from "openai/resources";
import { type AgentConfig } from "@/config/config";

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

export function registerSelfHostedModels(config: AgentConfig) {
    for (const modelConfig of config.models) {
        if (modelConfig.brand !== "self_hosted") {
            continue;
        }

        const { name, properties } = modelConfig;

        logger.info(`Registering self-hosted model: ${name} with base URL: ${properties.baseUrl} and API key: ${properties.apiKey ? "provided" : "not provided"}`);
        modelRegistry.registerModel(name, new SelfHostedModel(properties.baseUrl, name, properties.apiKey));
    }
}