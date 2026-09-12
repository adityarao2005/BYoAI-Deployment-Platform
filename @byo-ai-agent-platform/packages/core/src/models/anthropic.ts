import { Anthropic } from "@anthropic-ai/sdk";
import type {
    ModelInput,
    ModelInteraction,
    ModelMessageOutput,
} from "./conversation";
import type { Model } from "./models";

function toAnthropicInteraction(
    message: ModelInteraction[],
): Anthropic.Messages.MessageParam[] {
    return message.map((msg) => {
        if (msg.type === "message") {
            return {
                role: msg.role === "user" ? "user" : "assistant",
                content: msg.content,
            };
        } else if (msg.type === "tool_call") {
            return {
                role: "assistant",
                content: msg.tool.name,
                type: "tool_use",
                input: msg.arguments,
                id: msg.id,
            };
        } else if (msg.type === "tool_response") {
            return {
                role: "assistant",
                content: msg.tool.name,
                type: "tool_response",
                result: msg.result,
                id: msg.id,
            };
        } else {
            throw new Error(`Unknown message type: ${JSON.stringify(msg)}`);
        }
    });
}

export class AnthropicModel implements Model {
    private client: Anthropic;
    private modelName: string;
    private max_tokens: number;

    constructor(modelName: string, apiKey: string, max_tokens: number = 1024) {
        this.modelName = modelName;
        this.client = new Anthropic({ apiKey });
        this.max_tokens = max_tokens;
    }

    async execute(input: ModelInput): Promise<ModelMessageOutput[]> {
        const response = await this.client.messages.create({
            model: this.modelName,
            max_tokens: this.max_tokens,
            system: input.systemPrompt ?? "You are a helpful assistant.",
            messages: toAnthropicInteraction(input.history),
            tools: input.tools.map((tool) => ({
                input_schema: tool.inputSchema,
                name: tool.name,
                description: tool.description,
                strict: true,
            })),
        });

        if (response.content.length <= 0) {
            throw new Error(
                "No text output received from Anthropic model response.",
            );
        }

        const output = [] as ModelMessageOutput[];

        for (const message of response.content) {
            if (message.type === "text") {
                output.push({
                    role: "assistant",
                    type: "message",
                    content: message.text,
                });
            } else if (message.type === "tool_use") {
                const toolToUse = input.tools.find(
                    (tool) => tool.name === message.name,
                );

                if (!toolToUse) {
                    throw new Error(
                        `Tool ${message.name} not found in the provided tools.`,
                    );
                }

                output.push({
                    type: "tool_call",
                    arguments: message.input as Record<string, unknown>,
                    tool: toolToUse,
                    id: message.id,
                });
            }
        }

        return output;
    }
}
