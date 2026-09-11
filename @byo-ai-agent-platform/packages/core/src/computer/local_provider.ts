import type { LocalComputerUseToolProviderConfig } from "@/config/tool_config";
import type { Tool } from "@/tools";
import type {
    CaptureScreenshotArgs,
    CaptureScreenshotResult,
    ClickArgs,
    ComputerPayload,
    ComputerProvider,
    DragArgs,
    ExecuteArgs,
    ExecutionResult,
    GraphicalComputer,
    HeadlessComputer,
    KeyArgs,
    ListDirectoryArgs,
    ListDirectoryResult,
    MoveMouseToArgs,
    ReadFileArgs,
    ReadFileResult,
    ScreenSizeResult,
    ScrollArgs,
    SetClipboardArgs,
    TypeArgs,
    WriteFileArgs,
} from "@/computer/computer";
import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as process from "node:process";
import { randomUUID } from "node:crypto";
import { ComputerType } from "@/gen/computer_api/v1/computer_pb";

export const ERR_GRAPHICS_UNSUPPORTED = "graphical interface is not supported: DISPLAY environment variable is not set";

/**
 * LocalComputer implements HeadlessComputer using native Node.js process and filesystem APIs.
 * It provides local shell command execution, file read/write/list operations, and process user/group info.
 */
export class LocalComputer implements HeadlessComputer {
    /**
     * Executes a shell command locally.
     * Delegates shell execution to a child process (sh -c by default or specified custom shell).
     */
    async execute(args: ExecuteArgs): Promise<ExecutionResult> {
        return new Promise<ExecutionResult>((resolve, reject) => {
            const shellExecutable = args.shell ?? "sh";
            let spawnArgs: string[] = [];

            if (args.shellArgs && args.shellArgs.length > 0) {
                spawnArgs = [...args.shellArgs, args.command];
            } else if (args.shell !== "") {
                spawnArgs = ["-c", args.command];
            } else {
                // If explicit empty shell string passed, run command directly
                const parts = args.command.split(" ");
                const cmd = parts[0] || "";
                spawnArgs = parts.slice(1);
                const childDirect = spawn(cmd, spawnArgs, {
                    cwd: args.cwd,
                    env: { ...process.env, ...(args.envVars || {}) },
                });

                let stdoutDirect = "";
                let stderrDirect = "";
                childDirect.stdout.on("data", (chunk) => (stdoutDirect += chunk.toString()));
                childDirect.stderr.on("data", (chunk) => (stderrDirect += chunk.toString()));
                if (args.stdin) {
                    childDirect.stdin.write(args.stdin);
                    childDirect.stdin.end();
                }
                childDirect.on("error", reject);
                childDirect.on("close", (code) => {
                    resolve({ exitCode: code ?? 0, stdout: stdoutDirect, stderr: stderrDirect });
                });
                return;
            }

            const child = spawn(shellExecutable, spawnArgs, {
                cwd: args.cwd,
                env: { ...process.env, ...(args.envVars || {}) },
            });

            let stdout = "";
            let stderr = "";

            child.stdout.on("data", (chunk) => {
                stdout += chunk.toString();
            });

            child.stderr.on("data", (chunk) => {
                stderr += chunk.toString();
            });

            if (args.stdin) {
                child.stdin.write(args.stdin);
                child.stdin.end();
            }

            child.on("error", (err) => {
                reject(err);
            });

            child.on("close", (code) => {
                resolve({
                    exitCode: code ?? 0,
                    stdout,
                    stderr,
                });
            });
        });
    }

    /**
     * Reads file content from local filesystem.
     * Supports optional byte offset and limit range reading.
     */
    async readFile(args: ReadFileArgs): Promise<ReadFileResult> {
        if (args.offset !== undefined || args.limit !== undefined) {
            const handle = await fs.open(args.path, "r");
            try {
                const stat = await handle.stat();
                const startOffset = Number(args.offset ?? 0);
                const maxBytes = args.limit !== undefined ? Number(args.limit) : stat.size - startOffset;
                const buffer = Buffer.alloc(Math.max(0, maxBytes));
                const { bytesRead } = await handle.read(buffer, 0, buffer.length, startOffset);
                return { content: new Uint8Array(buffer.subarray(0, bytesRead)) };
            } finally {
                await handle.close();
            }
        }

        const buffer = await fs.readFile(args.path);
        return { content: new Uint8Array(buffer) };
    }

    /**
     * Writes or appends content to a local file.
     */
    async writeFile(args: WriteFileArgs): Promise<{ success: boolean }> {
        const flag = args.append ? "a" : "w";
        const content = typeof args.content === "string" ? Buffer.from(args.content) : args.content;
        await fs.writeFile(args.path, content, { flag });
        return { success: true };
    }

    /**
     * Lists directory entries for a local file path.
     */
    async listDirectory(args: ListDirectoryArgs): Promise<ListDirectoryResult> {
        const files = await fs.readdir(args.path);
        return { files };
    }

    /**
     * Gets current process OS user ID.
     */
    async getUserId(): Promise<{ userId: string }> {
        const uid = process.getuid ? process.getuid() : 1000;
        return { userId: uid.toString() };
    }

    /**
     * Gets current process OS group ID.
     */
    async getGroupId(): Promise<{ groupId: string }> {
        const gid = process.getgid ? process.getgid() : 1000;
        return { groupId: gid.toString() };
    }
}

/**
 * LocalGraphicalComputer extends LocalComputer with local desktop GUI automation.
 * Uses Linux utilities (xdotool, xclip, maim, scrot, import) to interact with X11 / desktop server.
 */
export class LocalGraphicalComputer extends LocalComputer implements GraphicalComputer {
    /**
     * Checks if local desktop graphics are supported (DISPLAY environment variable set).
     */
    supportsGraphics(): boolean {
        return Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
    }

    /**
     * Helper to run a local CLI tool command and return stdout buffer.
     */
    private runCommand(cmd: string, args: string[], stdin?: string): Promise<Buffer> {
        return new Promise<Buffer>((resolve, reject) => {
            if (!this.supportsGraphics()) {
                return reject(new Error(ERR_GRAPHICS_UNSUPPORTED));
            }

            const child = spawn(cmd, args, { env: process.env });
            const stdoutChunks: Buffer[] = [];
            const stderrChunks: Buffer[] = [];

            child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
            child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

            if (stdin !== undefined) {
                child.stdin.write(stdin);
                child.stdin.end();
            }

            child.on("error", (err) => reject(err));
            child.on("close", (code) => {
                if (code === 0) {
                    resolve(Buffer.concat(stdoutChunks));
                } else {
                    const stderrMsg = Buffer.concat(stderrChunks).toString();
                    reject(new Error(`Command '${cmd} ${args.join(" ")}' failed with code ${code}: ${stderrMsg}`));
                }
            });
        });
    }

    /**
     * Captures local screen screenshot as PNG image bytes.
     * Tries maim, scrot, or import in order.
     */
    async captureScreenshot(args: CaptureScreenshotArgs = {}): Promise<CaptureScreenshotResult> {
        if (!this.supportsGraphics()) {
            throw new Error(ERR_GRAPHICS_UNSUPPORTED);
        }

        const tools: { cmd: string; args: string[] }[] = [
            { cmd: "maim", args: ["-u"] },
            { cmd: "scrot", args: ["-z", "-"] },
            { cmd: "import", args: ["-window", "root", "png:-"] },
        ];

        for (const tool of tools) {
            try {
                const output = await this.runCommand(tool.cmd, tool.args);
                if (output.length > 0) {
                    return { imageData: new Uint8Array(output) };
                }
            } catch {
                // Try next screenshot utility
            }
        }

        throw new Error("failed to capture screenshot: no working screenshot tool found (maim, scrot, import)");
    }

    /**
     * Performs mouse click at (x, y) coordinates with specified button.
     */
    async click(args: ClickArgs): Promise<{ success: boolean }> {
        let btnNum = "1";
        const btnLower = (args.button || "left").toLowerCase();
        if (btnLower === "right" || btnLower === "3") {
            btnNum = "3";
        } else if (btnLower === "middle" || btnLower === "2") {
            btnNum = "2";
        }

        await this.runCommand("xdotool", ["mousemove", "--sync", args.x.toString(), args.y.toString(), "click", btnNum]);
        return { success: true };
    }

    /**
     * Types string text into focused active window.
     */
    async type(args: TypeArgs): Promise<{ success: boolean }> {
        await this.runCommand("xdotool", ["type", "--clearmodifiers", "--", args.text]);
        return { success: true };
    }

    /**
     * Presses key down.
     */
    async pressKey(args: KeyArgs): Promise<{ success: boolean }> {
        await this.runCommand("xdotool", ["keydown", args.key]);
        return { success: true };
    }

    /**
     * Releases key.
     */
    async releaseKey(args: KeyArgs): Promise<{ success: boolean }> {
        await this.runCommand("xdotool", ["keyup", args.key]);
        return { success: true };
    }

    /**
     * Presses and holds key down.
     */
    async pressAndHoldKey(args: KeyArgs): Promise<{ success: boolean }> {
        return this.pressKey(args);
    }

    /**
     * Releases all modifier and active keys.
     */
    async releaseAllKeys(): Promise<{ success: boolean }> {
        await this.runCommand("xdotool", [
            "keyup",
            "Shift_L",
            "Shift_R",
            "Control_L",
            "Control_R",
            "Alt_L",
            "Alt_R",
            "Meta_L",
            "Meta_R",
            "Super_L",
            "Super_R",
        ]);
        return { success: true };
    }

    /**
     * Drags mouse from (x1, y1) to (x2, y2).
     */
    async drag(args: DragArgs): Promise<{ success: boolean }> {
        await this.runCommand("xdotool", [
            "mousemove",
            "--sync",
            args.x1.toString(),
            args.y1.toString(),
            "mousedown",
            "1",
            "mousemove",
            "--sync",
            args.x2.toString(),
            args.y2.toString(),
            "mouseup",
            "1",
        ]);
        return { success: true };
    }

    /**
     * Moves mouse cursor to (x, y).
     */
    async moveMouseTo(args: MoveMouseToArgs): Promise<{ success: boolean }> {
        await this.runCommand("xdotool", ["mousemove", "--sync", args.x.toString(), args.y.toString()]);
        return { success: true };
    }

    /**
     * Scrolls mouse wheel vertically by dy and horizontally by dx.
     */
    async scroll(args: ScrollArgs): Promise<{ success: boolean }> {
        if (args.dy !== 0) {
            const btn = args.dy < 0 ? "4" : "5";
            const repeat = Math.abs(args.dy);
            await this.runCommand("xdotool", ["click", "--repeat", repeat.toString(), btn]);
        }

        if (args.dx !== 0) {
            const btn = args.dx < 0 ? "6" : "7";
            const repeat = Math.abs(args.dx);
            await this.runCommand("xdotool", ["click", "--repeat", repeat.toString(), btn]);
        }

        return { success: true };
    }

    /**
     * Reads text from system clipboard using xclip.
     */
    async getClipboard(): Promise<{ text: string }> {
        const out = await this.runCommand("xclip", ["-selection", "clipboard", "-o"]);
        return { text: out.toString() };
    }

    /**
     * Writes text to system clipboard using xclip.
     */
    async setClipboard(args: SetClipboardArgs): Promise<{ success: boolean }> {
        await this.runCommand("xclip", ["-selection", "clipboard"], args.text);
        return { success: true };
    }

    /**
     * Gets screen size geometry (width, height) using xdotool.
     */
    async getScreenSize(): Promise<ScreenSizeResult> {
        const out = await this.runCommand("xdotool", ["getdisplaygeometry"]);
        const parts = out.toString().trim().split(/\s+/);
        if (parts.length < 2) {
            throw new Error(`invalid display geometry output: '${out.toString()}'`);
        }

        const width = parseInt(parts[0]!, 10);
        const height = parseInt(parts[1]!, 10);
        if (Number.isNaN(width) || Number.isNaN(height)) {
            throw new Error(`failed to parse display geometry output: '${out.toString()}'`);
        }

        return { width, height };
    }
}

/**
 * LocalComputerUseToolProvider provides computer tools for local host execution.
 */
export class LocalComputerProvider implements ComputerProvider {
    config: LocalComputerUseToolProviderConfig;
    computers: Map<string, ComputerPayload>

    constructor(config: LocalComputerUseToolProviderConfig) {
        this.config = config;
        this.computers = new Map()
    }

    async init(): Promise<void> { }

    // create computer
    async createComputer(): Promise<string> {
        // check if it has display or if its graphical or not
        const hasDisplay = Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
        const isGraphical = this.config.enableGUIToolsIfAvailable && hasDisplay;

        // create random uuid and set into the map
        const computerId = randomUUID()
        this.computers.set(computerId, isGraphical ?
            { computer: new LocalGraphicalComputer(), type: ComputerType.GRAPHICAL } :
            { computer: new LocalComputer(), type: ComputerType.HEADLESS });

        // return
        return computerId
    }

    // delete computer
    async deleteComputer(computerId: string): Promise<void> {
        this.computers.delete(computerId)
    }

    // get computer
    async getComputer(computerId: string): Promise<ComputerPayload> {
        return this.computers.get(computerId) ?? { error: `Computer with id ${computerId} not found`, type: ComputerType.UNSPECIFIED }
    }
}
