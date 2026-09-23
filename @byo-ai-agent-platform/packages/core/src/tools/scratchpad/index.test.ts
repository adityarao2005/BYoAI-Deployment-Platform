import { describe, expect, it } from "bun:test";
import type { AgentSession } from "@/agents";
import { AgentMemory } from "@/agents/agent.memory";
import type { ToolCallRequest } from "@/models";
import { ScratchpadToolProvider } from ".";

describe("ScratchpadToolProvider", () => {
    const provider = new ScratchpadToolProvider();

    const createDummySession = (transcript: any[] = []): AgentSession => {
        return {
            agent: { id: "test-agent", name: "test-agent", userId: "user-1" },
            name: "test-session",
            userId: "user-1",
            memory: new AgentMemory("test-agent", "user-1", transcript),
        } as unknown as AgentSession;
    };

    it("should list all tools and get tools by name", async () => {
        const tools = await provider.getAllTools();
        expect(tools.map((t) => t.name)).toEqual(["get_scratchpad", "set_scratchpad"]);

        const getTool = await provider.getToolByName("get_scratchpad");
        expect(getTool).not.toBeNull();
        expect(getTool?.name).toBe("get_scratchpad");

        const setTool = await provider.getToolByName("set_scratchpad");
        expect(setTool).not.toBeNull();
        expect(setTool?.name).toBe("set_scratchpad");
        expect(setTool?.description).toBe("This tool allows you to set the contents of your own personal scratchpad.");

        const invalidTool = await provider.getToolByName("unknown_tool");
        expect(invalidTool).toBeNull();
    });

    describe("set_scratchpad", () => {
        it("should return success message upon updating scratchpad", async () => {
            const setTool = (await provider.getToolByName("set_scratchpad"))!;
            const session = createDummySession();
            const result = await setTool.execute({ content: "Hello scratchpad" }, session);

            expect(result).toEqual({
                message: "Success: Scratchpad updated to new state.",
            });
        });
    });

    describe("get_scratchpad", () => {
        it("should return empty content if no set_scratchpad entry exists in transcript", async () => {
            const getTool = (await provider.getToolByName("get_scratchpad"))!;
            const session = createDummySession([]);

            const result = await getTool.execute({}, session);
            expect(result).toEqual({ content: "" });
        });

        it("should return the latest set_scratchpad content from transcript", async () => {
            const getTool = (await provider.getToolByName("get_scratchpad"))!;
            const setTool = (await provider.getToolByName("set_scratchpad"))!;

            const entry1: ToolCallRequest = {
                type: "tool_call",
                id: "call_1",
                tool: setTool,
                arguments: { content: "First draft" },
            };

            const entry2: ToolCallRequest = {
                type: "tool_call",
                id: "call_2",
                tool: setTool,
                arguments: { content: "Second updated draft" },
            };

            const otherEntry = {
                type: "tool_call",
                id: "call_3",
                tool: { name: "other_tool" },
                arguments: { query: "something" },
            };

            const session = createDummySession([entry1, otherEntry, entry2]);

            const result = await getTool.execute({}, session);
            expect(result).toEqual({ content: "Second updated draft" });
        });
    });
});
