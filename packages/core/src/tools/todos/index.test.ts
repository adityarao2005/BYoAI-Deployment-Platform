import { describe, expect, it } from "bun:test";
import type { AgentSession } from "@/agents";
import { AgentMemory } from "@/agents/agent.memory";
import type { ToolCallRequest } from "@/models";
import { TodosToolProvider } from ".";

describe("TodosToolProvider", () => {
    const provider = new TodosToolProvider();

    const createDummySession = (transcript: any[] = []): AgentSession => {
        return {
            agent: { id: "test-agent", name: "test-agent", userId: "user-1" },
            name: "test-session",
            userId: "user-1",
            memory: new AgentMemory("test-agent", "user-1", transcript),
        } as unknown as AgentSession;
    };

    it("should list all tools and retrieve tools by name", async () => {
        const tools = await provider.getAllTools();
        expect(tools.map((t) => t.name)).toEqual([
            "get_todos",
            "add_todo",
            "complete_todos",
        ]);

        const getTodosTool = await provider.getToolByName("get_todos");
        expect(getTodosTool).not.toBeNull();
        expect(getTodosTool?.name).toBe("get_todos");

        const addTodoTool = await provider.getToolByName("add_todo");
        expect(addTodoTool).not.toBeNull();
        expect(addTodoTool?.name).toBe("add_todo");

        const completeTodosTool =
            await provider.getToolByName("complete_todos");
        expect(completeTodosTool).not.toBeNull();
        expect(completeTodosTool?.name).toBe("complete_todos");

        const invalidTool = await provider.getToolByName("unknown_tool");
        expect(invalidTool).toBeNull();
    });

    describe("add_todo", () => {
        it("should return success message upon adding a todo", async () => {
            const addTodoTool = (await provider.getToolByName("add_todo"))!;
            const session = createDummySession();
            const result = await addTodoTool.execute(
                { todo: "Buy groceries" },
                session,
            );

            expect(result).toEqual({
                message: "Success: Todo item added to list.",
            });
        });
    });

    describe("complete_todos", () => {
        it("should return success message upon marking todos completed", async () => {
            const completeTool = (await provider.getToolByName(
                "complete_todos",
            ))!;
            const session = createDummySession();
            const result = await completeTool.execute(
                { todoNumbers: [1, 2] },
                session,
            );

            expect(result).toEqual({
                message: "Success: Todo items marked as completed.",
            });
        });
    });

    describe("get_todos", () => {
        it("should return empty todo list when no todo actions exist in transcript", async () => {
            const getTodosTool = (await provider.getToolByName("get_todos"))!;
            const session = createDummySession([]);

            const result = await getTodosTool.execute({}, session);
            expect(result).toEqual({
                todos: "",
                items: [],
            });
        });

        it("should build numbered list of uncompleted todos from transcript", async () => {
            const getTodosTool = (await provider.getToolByName("get_todos"))!;
            const addTodoTool = (await provider.getToolByName("add_todo"))!;

            const entry1: ToolCallRequest = {
                type: "tool_call",
                id: "call_1",
                tool: addTodoTool,
                arguments: { todo: "Buy milk" },
            };

            const entry2: ToolCallRequest = {
                type: "tool_call",
                id: "call_2",
                tool: addTodoTool,
                arguments: { todo: "Walk the dog" },
            };

            const session = createDummySession([entry1, entry2]);

            const result = await getTodosTool.execute({}, session);
            expect(result).toEqual({
                todos: "1. [ ] Buy milk\n2. [ ] Walk the dog",
                items: [
                    { number: 1, todo: "Buy milk", completed: false },
                    { number: 2, todo: "Walk the dog", completed: false },
                ],
            });
        });

        it("should mark specific todo numbers as completed chronologically", async () => {
            const getTodosTool = (await provider.getToolByName("get_todos"))!;
            const addTodoTool = (await provider.getToolByName("add_todo"))!;
            const completeTool = (await provider.getToolByName(
                "complete_todos",
            ))!;

            const add1: ToolCallRequest = {
                type: "tool_call",
                id: "call_1",
                tool: addTodoTool,
                arguments: { todo: "Write unit tests" },
            };

            const add2: ToolCallRequest = {
                type: "tool_call",
                id: "call_2",
                tool: addTodoTool,
                arguments: { todo: "Fix biome lints" },
            };

            const add3: ToolCallRequest = {
                type: "tool_call",
                id: "call_3",
                tool: addTodoTool,
                arguments: { todo: "Deploy platform" },
            };

            const complete1And3: ToolCallRequest = {
                type: "tool_call",
                id: "call_4",
                tool: completeTool,
                arguments: { todoNumbers: [1, 3] },
            };

            const session = createDummySession([
                add1,
                add2,
                add3,
                complete1And3,
            ]);

            const result = await getTodosTool.execute({}, session);
            expect(result).toEqual({
                todos: "1. [x] Write unit tests\n2. [ ] Fix biome lints\n3. [x] Deploy platform",
                items: [
                    { number: 1, todo: "Write unit tests", completed: true },
                    { number: 2, todo: "Fix biome lints", completed: false },
                    { number: 3, todo: "Deploy platform", completed: true },
                ],
            });
        });

        it("should handle out of bound todo numbers gracefully", async () => {
            const getTodosTool = (await provider.getToolByName("get_todos"))!;
            const addTodoTool = (await provider.getToolByName("add_todo"))!;
            const completeTool = (await provider.getToolByName(
                "complete_todos",
            ))!;

            const add1: ToolCallRequest = {
                type: "tool_call",
                id: "call_1",
                tool: addTodoTool,
                arguments: { todo: "Refactor core" },
            };

            const completeInvalid: ToolCallRequest = {
                type: "tool_call",
                id: "call_2",
                tool: completeTool,
                arguments: { todoNumbers: [99, -1, 0] },
            };

            const session = createDummySession([add1, completeInvalid]);

            const result = await getTodosTool.execute({}, session);
            expect(result).toEqual({
                todos: "1. [ ] Refactor core",
                items: [{ number: 1, todo: "Refactor core", completed: false }],
            });
        });
    });
});
