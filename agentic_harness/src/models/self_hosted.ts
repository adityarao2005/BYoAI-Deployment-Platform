import OpenAI from "openai";
import { Message } from "./models";
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
        const response = await this.client.chat.completions.create({
            model: "self-hosted",
            messages: messages.map((message) => ({
                role: message.role,
                content: message.content,
            } satisfies OpenAI.ChatCompletionMessageParam)),
        })

        response.choices.forEach((choice, i) => {
            logger.info(`Choice ${i}: ${choice.message.content}`)
        })

        logger.info(`Selected Response: ${response.choices[0]!.message.content!}`)

        return {
            content: response.choices[0]!.message.content!,
            role: response.choices[0]!.message.role,
            type: "text"
        }
    }
}