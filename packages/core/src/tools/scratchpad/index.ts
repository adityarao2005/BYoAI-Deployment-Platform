import { isToolCallRequest } from "@/models";
import { z } from "zod";
import type { Tool, ToolProvider } from "@/tools";

export class ScratchpadToolProvider implements ToolProvider {
    async getToolByName(name: string): Promise<Tool | null> {
        return (await this.getAllTools()).find((tool) => tool.name === name) ?? null;
    }

    async getAllTools(): Promise<Tool[]> {
        return [
            {
                name: "get_scratchpad",
                description:
                    "This tool allows you to get the contents of your own personal scratchpad.",
                inputSchema: z.object({}),
                async execute(_, session) {
                    const memory = session.memory.transcript;

                    // find the latest entry of the tool call answer in the history
                    const lastSetContentEntry = memory
                        .filter(isToolCallRequest)
                        .findLast((entry) => {
                            if (
                                entry.type === "tool_call" &&
                                entry.tool.name === "set_scratchpad"
                            ) {
                                return true;
                            }

                            return false;
                        });

                    return {
                        content: lastSetContentEntry
                            ? lastSetContentEntry.arguments.content
                            : "",
                    };
                },
            },
            {
                name: "set_scratchpad",
                description:
                    "This tool allows you to set the contents of your own personal scratchpad.",
                inputSchema: z.object({
                    content: z
                        .string()
                        .describe("Content to be set in the scratchpad"),
                }),
                async execute(_args, _session) {
                    return {
                        message: "Success: Scratchpad updated to new state.",
                    };
                },
            },
        ];
    }
}