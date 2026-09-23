import type { ComputerType } from "@/gen/computer_api/v1/computer_pb";

/**
 * Arguments for executing a command on the computer shell.
 */
export interface ExecuteArgs {
    /** The shell command string to execute. */
    command: string;
    /** Optional working directory for command execution. */
    cwd?: string;
    /** Optional environment variables key-value map. */
    envVars?: Record<string, string>;
    /** Optional standard input string to pipe into command. */
    stdin?: string;
    /** Optional custom shell executable (e.g., /bin/bash, /bin/sh). */
    shell?: string;
    /** Optional shell arguments (e.g., ["-c"]). */
    shellArgs?: string[];
}

/**
 * Result of executing a shell command.
 */
export interface ExecutionResult {
    /** Exit status code (0 for success). */
    exitCode: number;
    /** Captured standard output. */
    stdout: string;
    /** Captured standard error output. */
    stderr: string;
}

/**
 * Arguments for reading a file.
 */
export interface ReadFileArgs {
    /** Target file path. */
    path: string;
    /** Optional byte offset to start reading from. */
    offset?: number | bigint;
    /** Optional byte limit for maximum read length. */
    limit?: number;
}

/**
 * Result of reading a file.
 */
export interface ReadFileResult {
    /** Raw file contents as byte array. */
    content: Uint8Array;
}

/**
 * Arguments for writing to a file.
 */
export interface WriteFileArgs {
    /** Target file path. */
    path: string;
    /** Content bytes or UTF-8 text to write. */
    content: string | Uint8Array;
    /** If true, appends content to file instead of overwriting. */
    append?: boolean;
}

/**
 * Arguments for listing directory contents.
 */
export interface ListDirectoryArgs {
    /** Target directory path. */
    path: string;
}

/**
 * Result of listing directory contents.
 */
export interface ListDirectoryResult {
    /** Array of file and directory names. */
    files: string[];
}

/**
 * Interactive stream session for executing commands with real-time stdin/stdout/stderr streaming.
 */
export interface StreamSession {
    /** Write binary or UTF-8 string data to process stdin. */
    writeStdin(data: Uint8Array | string): Promise<void>;
    /** Close standard input of the process. */
    closeStdin(): Promise<void>;
    /** Register listener for stdout byte chunks. */
    onStdout(listener: (chunk: Uint8Array) => void): void;
    /** Register listener for stderr byte chunks. */
    onStderr(listener: (chunk: Uint8Array) => void): void;
    /** Register listener for process exit code. */
    onExit(listener: (code: number) => void): void;
    /** Register listener for execution errors. */
    onError(listener: (error: Error) => void): void;
    /** Promise that resolves to the exit code when process terminates. */
    wait(): Promise<number>;
    /** Forcefully kill the running process. */
    kill(): Promise<void>;
}

/**
 * Arguments for starting a streaming execution session.
 */
export interface ExecuteStreamArgs {
    /** Command string or binary path to execute. */
    command: string;
    /** Optional working directory. */
    cwd?: string;
    /** Optional environment variables key-value map. */
    envVars?: Record<string, string>;
    /** Optional shell executable. Set to "" for direct execution without shell. */
    shell?: string;
    /** Optional shell arguments. */
    shellArgs?: string[];
}

/**
 * Abstraction for headless computer operations (shell execution, filesystem, process identity).
 */
export interface HeadlessComputer {
    /** Executes a command on the computer shell. */
    execute(args: ExecuteArgs): Promise<ExecutionResult>;
    /** Starts a real-time streaming execution session for interactive commands. */
    executeStream(args: ExecuteStreamArgs): Promise<StreamSession>;
    /** Reads content from a file path. */
    readFile(args: ReadFileArgs): Promise<ReadFileResult>;
    /** Writes content to a file path. */
    writeFile(args: WriteFileArgs): Promise<{ success: boolean }>;
    /** Lists entries in a directory path. */
    listDirectory(args: ListDirectoryArgs): Promise<ListDirectoryResult>;
    /** Gets OS user ID. */
    getUserId(): Promise<{ userId: string }>;
    /** Gets OS group ID. */
    getGroupId(): Promise<{ groupId: string }>;
}

/**
 * Arguments for capturing a screenshot.
 */
export interface CaptureScreenshotArgs {
    /** Optional crop region X coordinate. */
    x?: number;
    /** Optional crop region Y coordinate. */
    y?: number;
    /** Optional crop region width. */
    width?: number;
    /** Optional crop region height. */
    height?: number;
}

/**
 * Result of capturing a screenshot.
 */
export interface CaptureScreenshotResult {
    /** PNG image data byte array. */
    imageData: Uint8Array;
}

/**
 * Arguments for mouse click.
 */
export interface ClickArgs {
    /** X screen coordinate. */
    x: number;
    /** Y screen coordinate. */
    y: number;
    /** Mouse button ("left", "right", "middle"). Default is "left". */
    button?: string;
}

/**
 * Arguments for typing text.
 */
export interface TypeArgs {
    /** Text string to type. */
    text: string;
}

/**
 * Arguments for keyboard key operations.
 */
export interface KeyArgs {
    /** Key name string (e.g. "Return", "BackSpace", "Control_L"). */
    key: string;
}

/**
 * Arguments for mouse drag.
 */
export interface DragArgs {
    /** Start X screen coordinate. */
    x1: number;
    /** Start Y screen coordinate. */
    y1: number;
    /** End X screen coordinate. */
    x2: number;
    /** End Y screen coordinate. */
    y2: number;
}

/**
 * Arguments for moving mouse cursor.
 */
export interface MoveMouseToArgs {
    /** Target X screen coordinate. */
    x: number;
    /** Target Y screen coordinate. */
    y: number;
}

/**
 * Arguments for mouse wheel scrolling.
 */
export interface ScrollArgs {
    /** Horizontal scroll delta (positive = right, negative = left). */
    dx: number;
    /** Vertical scroll delta (positive = down, negative = up). */
    dy: number;
}

/**
 * Arguments for setting clipboard text.
 */
export interface SetClipboardArgs {
    /** Text content to copy into clipboard. */
    text: string;
}

/**
 * Result of getting screen dimensions.
 */
export interface ScreenSizeResult {
    /** Display width in pixels. */
    width: number;
    /** Display height in pixels. */
    height: number;
}

/**
 * Abstraction for graphical computer operations (desktop GUI automation, display, input, clipboard).
 * Extends HeadlessComputer.
 */
export interface GraphicalComputer extends HeadlessComputer {
    /** Captures screenshot of display as PNG image bytes. */
    captureScreenshot(
        args?: CaptureScreenshotArgs,
    ): Promise<CaptureScreenshotResult>;
    /** Clicks mouse button at (x, y) coordinates. */
    click(args: ClickArgs): Promise<{ success: boolean }>;
    /** Types text into currently focused active window. */
    type(args: TypeArgs): Promise<{ success: boolean }>;
    /** Presses key down. */
    pressKey(args: KeyArgs): Promise<{ success: boolean }>;
    /** Releases key. */
    releaseKey(args: KeyArgs): Promise<{ success: boolean }>;
    /** Presses and holds key down. */
    pressAndHoldKey(args: KeyArgs): Promise<{ success: boolean }>;
    /** Releases all active modifier keys. */
    releaseAllKeys(): Promise<{ success: boolean }>;
    /** Drags mouse from (x1, y1) to (x2, y2). */
    drag(args: DragArgs): Promise<{ success: boolean }>;
    /** Moves mouse cursor to (x, y). */
    moveMouseTo(args: MoveMouseToArgs): Promise<{ success: boolean }>;
    /** Scrolls mouse wheel vertically or horizontally. */
    scroll(args: ScrollArgs): Promise<{ success: boolean }>;
    /** Reads text content from system clipboard. */
    getClipboard(): Promise<{ text: string }>;
    /** Writes text content to system clipboard. */
    setClipboard(args: SetClipboardArgs): Promise<{ success: boolean }>;
    /** Gets screen resolution dimensions. */
    getScreenSize(): Promise<ScreenSizeResult>;
}

export type ComputerPayload =
    | {
          type: ComputerType.GRAPHICAL;
          computer: GraphicalComputer;
      }
    | {
          type: ComputerType.HEADLESS;
          computer: HeadlessComputer;
      }
    | {
          type: ComputerType.UNSPECIFIED;
          error: string;
      };

/**
 * Provides the computer for you
 */
export interface ComputerProvider {
    /**
     * Initializes provider
     */
    init(): Promise<void>;

    /**
     * Creates a computer for you, returns an id for the computer
     */
    createComputer(): Promise<string>;

    /**
     * Receives a computer for you
     * @param computerId computer id
     */
    getComputer(computerId: string): Promise<ComputerPayload>;

    /**
     * Deletes a computer for you
     * @param computerId computer id
     */
    deleteComputer(computerId: string): Promise<void>;

    /**
     * Uploads and extracts a skills ZIP archive to the target computer session.
     * Returns the path on the computer where the skills are stored.
     * @param computerId computer id
     * @param zipData ZIP archive bytes
     */
    sendSkillsZip?(computerId: string, zipData: Buffer): Promise<string>;
}
