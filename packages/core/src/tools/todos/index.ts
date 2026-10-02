import { isToolCallRequest } from "@/models";
import { z } from "zod";
import type { Tool, ToolProvider } from "@/tools";

export class TodosToolProvider implements ToolProvider {
    async getToolByName(name: string): Promise<Tool | null> {
        return (
            (await this.getAllTools()).find((tool) => tool.name === name) ??
            null
        );
    }

    async getAllTools(): Promise<Tool[]> {
        return [
            {
                name: "get_todos",
                description:
                    "This tool allows you to get a numbered list of your todo items.",
                inputSchema: z.object({}),
                async execute(_, session) {
                    const memory = session.memory.transcript;

                    const todos: Array<{ todo: string; completed: boolean }> =
                        [];
                    const toolCalls = memory.filter(isToolCallRequest);

                    for (const entry of toolCalls) {
                        if (entry.type === "tool_call") {
                            if (entry.tool.name === "add_todo") {
                                const todoText = (entry.arguments.todo ??
                                    entry.arguments.task ??
                                    entry.arguments.content) as string;
                                if (
                                    typeof todoText === "string" &&
                                    todoText.trim() !== ""
                                ) {
                                    todos.push({
                                        todo: todoText,
                                        completed: false,
                                    });
                                }
                            } else if (entry.tool.name === "complete_todos") {
                                const rawNumbers =
                                    entry.arguments.todoNumbers ??
                                    entry.arguments.todo_numbers ??
                                    entry.arguments.numbers;
                                const numbers = Array.isArray(rawNumbers)
                                    ? rawNumbers
                                    : typeof rawNumbers === "number"
                                      ? [rawNumbers]
                                      : [];
                                for (const num of numbers) {
                                    const item = todos[num - 1];
                                    if (item) {
                                        item.completed = true;
                                    }
                                }
                            }
                        }
                    }

                    const formattedList = todos
                        .map(
                            (item, idx) =>
                                `${idx + 1}. [${item.completed ? "x" : " "}] ${item.todo}`,
                        )
                        .join("\n");

                    return {
                        todos: formattedList,
                        items: todos.map((item, idx) => ({
                            number: idx + 1,
                            todo: item.todo,
                            completed: item.completed,
                        })),
                    };
                },
            },
            {
                name: "add_todo",
                description:
                    "This tool allows you to add an uncompleted todo item to the list.",
                inputSchema: z.object({
                    todo: z
                        .string()
                        .describe("The todo item description or task to add."),
                }),
                async execute(_args, _session) {
                    return {
                        message: "Success: Todo item added to list.",
                    };
                },
            },
            {
                name: "complete_todos",
                description:
                    "This tool allows you to mark one or more todo items as completed given their todo numbers.",
                inputSchema: z.object({
                    todoNumbers: z
                        .array(z.number().int())
                        .describe(
                            "List of 1-based todo item numbers to mark as completed",
                        ),
                }),
                async execute(_args, _session) {
                    return {
                        message: "Success: Todo items marked as completed.",
                    };
                },
            },
        ];
    }
}
