import OpenAI from "openai";
import type { ChatCompletionAssistantMessageParam } from "openai/resources";
import type {
    ModelInput,
    ModelInteraction,
    ModelMessageOutput,
} from "./conversation";
import type { Model } from "./models";
import { getToolJsonSchema } from "@/tools/schema";

function toChatCompletionInteraction(
    message: ModelInteraction[],
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
    return message.map((msg) => {
        if (msg.type === "message") {
            return {
                role: msg.role,
                content: msg.content,
            };
        } else if (msg.type === "tool_call") {
            return {
                role: "assistant",
                tool_calls: [
                    {
                        id: msg.id,
                        type: "function",
                        function: {
                            arguments: JSON.stringify(msg.arguments),
                            name: msg.tool.name,
                        },
                    },
                ],
            } as ChatCompletionAssistantMessageParam;
        } else if (msg.type === "tool_response") {
            let contentStr: string;
            const res = msg.result as any;
            if (typeof res === "string") {
                contentStr = res;
            } else if (
                res &&
                typeof res === "object" &&
                "content" in res &&
                (res.content instanceof Uint8Array ||
                    (res.content &&
                        typeof res.content === "object" &&
                        res.content.type === "Buffer" &&
                        Array.isArray(res.content.data)))
            ) {
                const rawData =
                    res.content instanceof Uint8Array
                        ? res.content
                        : new Uint8Array(res.content.data);
                contentStr = new TextDecoder().decode(rawData);
            } else {
                contentStr = JSON.stringify(msg.result);
            }
            return {
                role: "tool",
                content: contentStr,
                tool_call_id: msg.id,
                name: msg.tool.name,
            };
        } else {
            throw new Error(`Unknown message type: ${msg}`);
        }
    });
}

export class SelfHostedModel implements Model {
    private client: OpenAI;
    readonly name: string;

    constructor(baseURL: string, modelName: string, apiKey?: string) {
        this.name = modelName;
        this.client = new OpenAI({
            baseURL,
            apiKey: apiKey ?? "local-api-key",
        });
    }

    async execute(input: ModelInput): Promise<ModelMessageOutput[]> {
        const response = await this.client.chat.completions.create({
            model: this.name,
            messages: [
                {
                    role: "system",
                    content:
                        input.systemPrompt ?? "You are a helpful assistant.",
                },
                ...toChatCompletionInteraction(input.history),
            ],
            tools: input.tools.map((tool) => ({
                type: "function",
                function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: getToolJsonSchema(
                        tool.inputSchema,
                    ) as Record<string, unknown>,
                },
            })),
        });

        if (response.choices.length === 0) {
            throw new Error(
                "No response choices received from self-hosted model.",
            );
        }

        const message = response.choices[0]!.message;

        const outputs: ModelMessageOutput[] = [];

        if (message.content) {
            outputs.push({
                role: "assistant",
                type: "message",
                content: message.content,
            });
        }

        if (message.tool_calls && message.tool_calls.length > 0) {
            for (const tool of message.tool_calls) {
                if (tool.type !== "function") continue;

                const toolToUse = input.tools.find(
                    (t) => t.name === tool.function.name,
                );

                if (!toolToUse) {
                    throw new Error(
                        `Tool not found for function call: ${tool.function.name}`,
                    );
                }

                let parsedArgs = {};
                try {
                    parsedArgs = tool.function.arguments
                        ? JSON.parse(tool.function.arguments)
                        : {};
                } catch {
                    parsedArgs = {};
                }

                outputs.push({
                    type: "tool_call",
                    arguments: parsedArgs,
                    id: tool.id,
                    tool: toolToUse,
                });
            }
        }

        return outputs;
    }
}
