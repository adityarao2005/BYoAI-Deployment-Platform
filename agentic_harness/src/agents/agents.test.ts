import { describe, expect, test } from "vitest";
import { Model, modelRegistry } from "@/models/models";
import { Agent } from "./agents";

const DUMMY_MESSAGE = "Hello, I am a dummy model!"

describe("Agents Unit Test", () => {

    const model = {
        async execute(messages) {
            return {
                role: "assistant",
                type: "text",
                content: DUMMY_MESSAGE
            }
        }
    } satisfies Model;

    // register the model as mock
    modelRegistry.registerModel("default", model)

    const agent = new Agent("New Agent", [], [])

    test("Agent should perform task and return expected message", async () => {
        const response = await agent.performTask("What is the meaning of life?");
        expect(response.content).toBe(DUMMY_MESSAGE);
    });
})