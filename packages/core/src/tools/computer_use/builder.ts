import type { Tool } from "@/tools";
import { z } from "zod";
import type {
    GraphicalComputer,
    HeadlessComputer,
} from "../../computer/computer";
import {
    type ComputerPermissions,
    assertCommandAllowed,
    assertPathAllowed,
} from "./permissions";

/**
 * Creates Tool objects for headless computer operations.
 *
 * @param computer HeadlessComputer implementation
 * @param permissions Optional permissions rules governing read, write, and command execution
 * @returns Array of Tool objects (execute, read_file, write_file, list_directory, get_user_id, get_group_id)
 */
export function createHeadlessTools(
    computer: HeadlessComputer,
    permissions?: ComputerPermissions,
): Tool[] {
    return [
        {
            name: "execute",
            description: "Execute a command on the computer shell.",
            inputSchema: z.object({
                command: z
                    .string()
                    .describe("The command to execute on the shell."),
                cwd: z
                    .string()
                    .optional()
                    .describe("Working directory for the command execution."),
                envVars: z
                    .record(z.string(), z.any())
                    .optional()
                    .describe("Environment variables key-value map."),
                stdin: z
                    .string()
                    .optional()
                    .describe("Input data for standard input."),
                shell: z
                    .string()
                    .optional()
                    .describe("Custom shell executable."),
                shellArgs: z
                    .array(z.string())
                    .optional()
                    .describe("Arguments for the shell."),
            }),
            execute: async (args: Record<string, any>) => {
                if (permissions?.execute) {
                    assertCommandAllowed(args.command, permissions.execute);
                }
                return computer.execute({
                    command: args.command,
                    cwd: args.cwd,
                    envVars: args.envVars || args.env_vars,
                    stdin: args.stdin,
                    shell: args.shell,
                    shellArgs: args.shellArgs || args.shell_args,
                });
            },
        },
        {
            name: "read_file",
            description: "Read content from a file on the computer.",
            inputSchema: z.object({
                path: z.string().describe("Path to the file to read."),
                offset: z
                    .number()
                    .int()
                    .optional()
                    .describe("Optional byte offset to start reading from."),
                limit: z
                    .number()
                    .int()
                    .optional()
                    .describe("Optional maximum bytes to read."),
            }),
            execute: async (args: Record<string, any>) => {
                if (permissions?.read) {
                    assertPathAllowed("read", args.path, permissions.read);
                }
                const result = await computer.readFile({
                    path: args.path,
                    offset: args.offset,
                    limit: args.limit,
                });
                try {
                    return {
                        content: new TextDecoder("utf-8", { fatal: true }).decode(result.content),
                    };
                } catch {
                    return {
                        content: Buffer.from(result.content).toString("base64"),
                        isBase64: true,
                    };
                }
            },
        },
        {
            name: "write_file",
            description: "Write content to a file on the computer.",
            inputSchema: z.object({
                path: z.string().describe("Path to the file to write."),
                content: z.string().describe("Content to write to the file."),
                append: z
                    .boolean()
                    .optional()
                    .describe("Whether to append content to existing file."),
            }),
            execute: async (args: Record<string, any>) => {
                if (permissions?.write) {
                    assertPathAllowed("write", args.path, permissions.write);
                }
                return computer.writeFile({
                    path: args.path,
                    content: args.content,
                    append: args.append,
                });
            },
        },
        {
            name: "list_directory",
            description: "List contents of a directory on the computer.",
            inputSchema: z.object({
                path: z.string().describe("Directory path to list."),
            }),
            execute: async (args: Record<string, any>) => {
                if (permissions?.read) {
                    assertPathAllowed("read", args.path, permissions.read);
                }
                return computer.listDirectory({
                    path: args.path,
                });
            },
        },
        {
            name: "get_user_id",
            description: "Get the current user ID on the computer.",
            inputSchema: z.object({}),
            execute: async () => {
                return computer.getUserId();
            },
        },
        {
            name: "get_group_id",
            description: "Get the current group ID on the computer.",
            inputSchema: z.object({}),
            execute: async () => {
                return computer.getGroupId();
            },
        },
    ];
}

/**
 * Creates Tool objects for graphical computer operations.
 *
 * @param computer GraphicalComputer implementation
 * @returns Array of Tool objects (capture_screenshot, click, type, press_key, release_key, press_and_hold_key, release_all_keys, drag, move_mouse_to, scroll, get_clipboard, set_clipboard, get_screen_size)
 */
export function createGraphicalTools(computer: GraphicalComputer): Tool[] {
    return [
        {
            name: "capture_screenshot",
            description: "Capture a screenshot of the computer screen.",
            inputSchema: z.object({
                x: z
                    .number()
                    .int()
                    .optional()
                    .describe("Optional top-left X coordinate for crop region."),
                y: z
                    .number()
                    .int()
                    .optional()
                    .describe("Optional top-left Y coordinate for crop region."),
                width: z
                    .number()
                    .int()
                    .optional()
                    .describe("Optional width for crop region."),
                height: z
                    .number()
                    .int()
                    .optional()
                    .describe("Optional height for crop region."),
            }),
            execute: async (args: Record<string, any> = {}) => {
                return computer.captureScreenshot(args);
            },
        },
        {
            name: "click",
            description: "Click mouse at specified coordinates.",
            inputSchema: z.object({
                x: z.number().int().describe("X coordinate for click."),
                y: z.number().int().describe("Y coordinate for click."),
                button: z
                    .string()
                    .optional()
                    .describe("Mouse button (e.g. left, right, middle)."),
            }),
            execute: async (args: Record<string, any>) => {
                return computer.click({
                    x: args.x,
                    y: args.y,
                    button: args.button,
                });
            },
        },
        {
            name: "type",
            description: "Type text into the active window.",
            inputSchema: z.object({
                text: z.string().describe("Text to type."),
            }),
            execute: async (args: Record<string, any>) => {
                return computer.type({ text: args.text });
            },
        },
        {
            name: "press_key",
            description: "Press a key on the keyboard.",
            inputSchema: z.object({
                key: z.string().describe("Key name to press."),
            }),
            execute: async (args: Record<string, any>) => {
                return computer.pressKey({ key: args.key });
            },
        },
        {
            name: "release_key",
            description: "Release a key on the keyboard.",
            inputSchema: z.object({
                key: z.string().describe("Key name to release."),
            }),
            execute: async (args: Record<string, any>) => {
                return computer.releaseKey({ key: args.key });
            },
        },
        {
            name: "press_and_hold_key",
            description: "Press and hold a key on the keyboard.",
            inputSchema: z.object({
                key: z.string().describe("Key name to press and hold."),
            }),
            execute: async (args: Record<string, any>) => {
                return computer.pressAndHoldKey({ key: args.key });
            },
        },
        {
            name: "release_all_keys",
            description: "Release all held keys on the keyboard.",
            inputSchema: z.object({}),
            execute: async () => {
                return computer.releaseAllKeys();
            },
        },
        {
            name: "drag",
            description:
                "Drag mouse from starting coordinates to ending coordinates.",
            inputSchema: z.object({
                x1: z.number().int().describe("Start X coordinate."),
                y1: z.number().int().describe("Start Y coordinate."),
                x2: z.number().int().describe("End X coordinate."),
                y2: z.number().int().describe("End Y coordinate."),
            }),
            execute: async (args: Record<string, any>) => {
                return computer.drag({
                    x1: args.x1,
                    y1: args.y1,
                    x2: args.x2,
                    y2: args.y2,
                });
            },
        },
        {
            name: "move_mouse_to",
            description: "Move mouse cursor to coordinates.",
            inputSchema: z.object({
                x: z.number().int().describe("X coordinate."),
                y: z.number().int().describe("Y coordinate."),
            }),
            execute: async (args: Record<string, any>) => {
                return computer.moveMouseTo({
                    x: args.x,
                    y: args.y,
                });
            },
        },
        {
            name: "scroll",
            description: "Scroll screen horizontally or vertically.",
            inputSchema: z.object({
                dx: z.number().int().describe("Horizontal scroll delta."),
                dy: z.number().int().describe("Vertical scroll delta."),
            }),
            execute: async (args: Record<string, any>) => {
                return computer.scroll({
                    dx: args.dx,
                    dy: args.dy,
                });
            },
        },
        {
            name: "get_clipboard",
            description: "Get text content from the clipboard.",
            inputSchema: z.object({}),
            execute: async () => {
                return computer.getClipboard();
            },
        },
        {
            name: "set_clipboard",
            description: "Set text content in the clipboard.",
            inputSchema: z.object({
                text: z.string().describe("Text to set in clipboard."),
            }),
            execute: async (args: Record<string, any>) => {
                return computer.setClipboard({ text: args.text });
            },
        },
        {
            name: "get_screen_size",
            description: "Get the screen size dimensions.",
            inputSchema: z.object({}),
            execute: async () => {
                return computer.getScreenSize();
            },
        },
    ];
}
