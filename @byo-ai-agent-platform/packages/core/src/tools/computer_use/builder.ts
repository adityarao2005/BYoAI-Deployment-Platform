import type { Tool } from "@/tools";
import { toolArray, toolBoolean, toolInteger, toolObject, toolString } from "@/tools/tool_argument";
import type { GraphicalComputer, HeadlessComputer } from "../../computer/computer";

/**
 * Creates Tool objects for headless computer operations.
 *
 * @param computer HeadlessComputer implementation
 * @returns Array of Tool objects (execute, read_file, write_file, list_directory, get_user_id, get_group_id)
 */
export function createHeadlessTools(computer: HeadlessComputer): Tool[] {
    return [
        {
            name: "execute",
            description: "Execute a command on the computer shell.",
            inputSchema: toolObject(
                "Execute command inputs",
                {
                    command: toolString("The command to execute on the shell."),
                    cwd: toolString("Working directory for the command execution."),
                    envVars: toolObject("Environment variables key-value map.", {}, undefined, true),
                    stdin: toolString("Input data for standard input."),
                    shell: toolString("Custom shell executable."),
                    shellArgs: toolArray(toolString("Shell argument"), "Arguments for the shell.")
                },
                ["command"]
            ),
            execute: async (args: Record<string, any>) => {
                return computer.execute({
                    command: args.command,
                    cwd: args.cwd,
                    envVars: args.envVars || args.env_vars,
                    stdin: args.stdin,
                    shell: args.shell,
                    shellArgs: args.shellArgs || args.shell_args,
                });
            }
        },
        {
            name: "read_file",
            description: "Read content from a file on the computer.",
            inputSchema: toolObject(
                "Read file inputs",
                {
                    path: toolString("Path to the file to read."),
                    offset: toolInteger("Optional byte offset to start reading from."),
                    limit: toolInteger("Optional maximum bytes to read.")
                },
                ["path"]
            ),
            execute: async (args: Record<string, any>) => {
                return computer.readFile({
                    path: args.path,
                    offset: args.offset,
                    limit: args.limit,
                });
            }
        },
        {
            name: "write_file",
            description: "Write content to a file on the computer.",
            inputSchema: toolObject(
                "Write file inputs",
                {
                    path: toolString("Path to the file to write."),
                    content: toolString("Content to write to the file."),
                    append: toolBoolean("Whether to append content to existing file.")
                },
                ["path", "content"]
            ),
            execute: async (args: Record<string, any>) => {
                return computer.writeFile({
                    path: args.path,
                    content: args.content,
                    append: args.append,
                });
            }
        },
        {
            name: "list_directory",
            description: "List contents of a directory on the computer.",
            inputSchema: toolObject(
                "List directory inputs",
                {
                    path: toolString("Directory path to list.")
                },
                ["path"]
            ),
            execute: async (args: Record<string, any>) => {
                return computer.listDirectory({
                    path: args.path,
                });
            }
        },
        {
            name: "get_user_id",
            description: "Get the current user ID on the computer.",
            inputSchema: toolObject("Get user ID inputs", {}),
            execute: async () => {
                return computer.getUserId();
            }
        },
        {
            name: "get_group_id",
            description: "Get the current group ID on the computer.",
            inputSchema: toolObject("Get group ID inputs", {}),
            execute: async () => {
                return computer.getGroupId();
            }
        }
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
            inputSchema: toolObject(
                "Capture screenshot inputs",
                {
                    x: toolInteger("Optional top-left X coordinate for crop region."),
                    y: toolInteger("Optional top-left Y coordinate for crop region."),
                    width: toolInteger("Optional width for crop region."),
                    height: toolInteger("Optional height for crop region.")
                }
            ),
            execute: async (args: Record<string, any> = {}) => {
                return computer.captureScreenshot(args);
            }
        },
        {
            name: "click",
            description: "Click mouse at specified coordinates.",
            inputSchema: toolObject(
                "Click inputs",
                {
                    x: toolInteger("X coordinate for click."),
                    y: toolInteger("Y coordinate for click."),
                    button: toolString("Mouse button (e.g. left, right, middle).")
                },
                ["x", "y"]
            ),
            execute: async (args: Record<string, any>) => {
                return computer.click({
                    x: args.x,
                    y: args.y,
                    button: args.button,
                });
            }
        },
        {
            name: "type",
            description: "Type text into the active window.",
            inputSchema: toolObject(
                "Type inputs",
                {
                    text: toolString("Text to type.")
                },
                ["text"]
            ),
            execute: async (args: Record<string, any>) => {
                return computer.type({ text: args.text });
            }
        },
        {
            name: "press_key",
            description: "Press a key on the keyboard.",
            inputSchema: toolObject(
                "Press key inputs",
                {
                    key: toolString("Key name to press.")
                },
                ["key"]
            ),
            execute: async (args: Record<string, any>) => {
                return computer.pressKey({ key: args.key });
            }
        },
        {
            name: "release_key",
            description: "Release a key on the keyboard.",
            inputSchema: toolObject(
                "Release key inputs",
                {
                    key: toolString("Key name to release.")
                },
                ["key"]
            ),
            execute: async (args: Record<string, any>) => {
                return computer.releaseKey({ key: args.key });
            }
        },
        {
            name: "press_and_hold_key",
            description: "Press and hold a key on the keyboard.",
            inputSchema: toolObject(
                "Press and hold key inputs",
                {
                    key: toolString("Key name to press and hold.")
                },
                ["key"]
            ),
            execute: async (args: Record<string, any>) => {
                return computer.pressAndHoldKey({ key: args.key });
            }
        },
        {
            name: "release_all_keys",
            description: "Release all held keys on the keyboard.",
            inputSchema: toolObject("Release all keys inputs", {}),
            execute: async () => {
                return computer.releaseAllKeys();
            }
        },
        {
            name: "drag",
            description: "Drag mouse from starting coordinates to ending coordinates.",
            inputSchema: toolObject(
                "Drag inputs",
                {
                    x1: toolInteger("Start X coordinate."),
                    y1: toolInteger("Start Y coordinate."),
                    x2: toolInteger("End X coordinate."),
                    y2: toolInteger("End Y coordinate.")
                },
                ["x1", "y1", "x2", "y2"]
            ),
            execute: async (args: Record<string, any>) => {
                return computer.drag({
                    x1: args.x1,
                    y1: args.y1,
                    x2: args.x2,
                    y2: args.y2,
                });
            }
        },
        {
            name: "move_mouse_to",
            description: "Move mouse cursor to coordinates.",
            inputSchema: toolObject(
                "Move mouse to inputs",
                {
                    x: toolInteger("X coordinate."),
                    y: toolInteger("Y coordinate.")
                },
                ["x", "y"]
            ),
            execute: async (args: Record<string, any>) => {
                return computer.moveMouseTo({
                    x: args.x,
                    y: args.y,
                });
            }
        },
        {
            name: "scroll",
            description: "Scroll screen horizontally or vertically.",
            inputSchema: toolObject(
                "Scroll inputs",
                {
                    dx: toolInteger("Horizontal scroll delta."),
                    dy: toolInteger("Vertical scroll delta.")
                },
                ["dx", "dy"]
            ),
            execute: async (args: Record<string, any>) => {
                return computer.scroll({
                    dx: args.dx,
                    dy: args.dy,
                });
            }
        },
        {
            name: "get_clipboard",
            description: "Get text content from the clipboard.",
            inputSchema: toolObject("Get clipboard inputs", {}),
            execute: async () => {
                return computer.getClipboard();
            }
        },
        {
            name: "set_clipboard",
            description: "Set text content in the clipboard.",
            inputSchema: toolObject(
                "Set clipboard inputs",
                {
                    text: toolString("Text to set in clipboard.")
                },
                ["text"]
            ),
            execute: async (args: Record<string, any>) => {
                return computer.setClipboard({ text: args.text });
            }
        },
        {
            name: "get_screen_size",
            description: "Get the screen size dimensions.",
            inputSchema: toolObject("Get screen size inputs", {}),
            execute: async () => {
                return computer.getScreenSize();
            }
        }
    ];
}
