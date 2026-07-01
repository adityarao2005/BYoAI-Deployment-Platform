import { describe, expect, test } from "vitest";
import { Model, modelRegistry } from "@/models/models";
import { Agent } from "./agents";
import { ModelInteraction, ModelMessageInput, ModelMessageOutput } from "@/models/conversation";
import { Tool, ToolProvider } from "@/tools/tools";
import { logger } from "@/logger";

const DUMMY_MESSAGE = "Hello, I am a dummy model!"

describe("Agents Unit Test", () => {

    test("Agent should perform task and return expected message", async () => {

        // query
        const query: ModelInteraction[] = [{
            type: "message",
            role: "user",
            content: "What is the meaning of life?"
        }]

        // expected message
        const expectedMessage: ModelMessageOutput[] = [{
            role: "assistant",
            type: "message",
            content: DUMMY_MESSAGE
        }]

        // model which returns expected message
        const model = {
            async execute(input) {
                return expectedMessage
            }
        } satisfies Model;

        // register the model as mock
        modelRegistry.registerModel("default", model)

        // new agent
        const agent = new Agent("New Agent", [], [])

        // perform task
        const response = await agent.performTask({
            history: query
        });

        expect(response.history).toStrictEqual([
            ...query,
            ...expectedMessage
        ]);
    });

    test("Agent should perform task with multi message input and multi message output", async () => {

        // query
        const query: ModelInteraction[] = [{
            type: "message",
            role: "user",
            content: "What is the meaning of life?"
        }, {
            type: "message",
            role: "user",
            content: "What is the meaning of life?"
        }, {
            type: "message",
            role: "user",
            content: "What is the meaning of life?"
        }]

        // expected message
        const expectedMessage: ModelMessageOutput[] = [{
            role: "assistant",
            type: "message",
            content: DUMMY_MESSAGE
        }, {
            role: "assistant",
            type: "message",
            content: DUMMY_MESSAGE
        }]

        // model which returns expected message
        const model = {
            async execute(input) {
                return expectedMessage
            }
        } satisfies Model;

        // register the model as mock
        modelRegistry.registerModel("default", model)

        // new agent
        const agent = new Agent("New Agent", [], [])

        // perform task
        const response = await agent.performTask({
            history: query
        });

        expect(response.history).toStrictEqual([
            ...query,
            ...expectedMessage
        ]);
    });


    // weather tool
    let weatherToolCalled = false;

    const weatherTool: Tool = {
        name: "get_weather",
        async execute(args) {
            // set weather tool called to true
            weatherToolCalled = true;
            return `The weather is sunny with a high of 25°C at ${args.location}.`
        },
        description: "Get the current weather for a given location.",
        inputSchema: {
            type: "object",
            description: "Input schema for the get_weather tool.",
            properties: {
                location: {
                    type: "string",
                    description: "The location to get the weather for."
                }
            },
            required: ["location"]
        }
    }

    // weather tool provider
    const weatherToolProvider: ToolProvider = {
        async getAllTools() {
            return [weatherTool]
        },
        async getToolByName(name) {
            return name === weatherTool.name ? weatherTool : null
        },
    }

    test("Agent should perform task with tool call", async () => {

        weatherToolCalled = false;

        // query
        const query: ModelInteraction[] = [{
            type: "message",
            role: "user",
            content: "What is the weather like today?"
        }]

        // expected tool message
        const expectedToolMessage: ModelMessageOutput[] = [{
            type: "tool_call",
            id: "tool_call_1",
            tool: weatherTool,
            arguments: {
                location: "New York"
            }
        }]

        const expectedToolResponseMessage: ModelMessageInput[] = [{
            type: "tool_response",
            id: "tool_call_1",
            tool: weatherTool,
            result: "The weather is sunny with a high of 25°C at New York."
        }]

        const expectedMessage: ModelMessageOutput[] = [{
            type: "message",
            role: "assistant",
            content: "The weather is sunny with a high of 25°C at New York."
        }]

        // model which returns expected message
        const model = {
            async execute(input) {
                // if not called, return tool call message, else return expected message
                if (!weatherToolCalled) {
                    return expectedToolMessage
                } else {
                    return expectedMessage
                }
            }
        } satisfies Model;

        // register the model as mock
        modelRegistry.registerModel("default", model)

        // new agent
        const agent = new Agent("New Agent", [], [weatherToolProvider])

        // perform task
        const response = await agent.performTask({
            history: query
        });

        const expected = [...query, ...expectedToolMessage, ...expectedToolResponseMessage, ...expectedMessage];
        logger.info(`History: ${JSON.stringify(response.history)}`);
        logger.info(`Expected: ${JSON.stringify(expected)}`);
        expect(response.history).toStrictEqual(expected);

        weatherToolCalled = true;
    });
})