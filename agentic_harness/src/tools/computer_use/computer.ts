export interface ExecuteArgs {
    command: string;
    cwd?: string;
    envVars?: Record<string, string>;
    stdin?: string;
    shell?: string;
    shellArgs?: string[];
}

export interface ExecutionResult {
    exitCode: number;
    stdout: string;
    stderr: string;
}

export interface ReadFileArgs {
    path: string;
    offset?: number | bigint;
    limit?: number;
}

export interface ReadFileResult {
    content: Uint8Array;
}

export interface WriteFileArgs {
    path: string;
    content: string | Uint8Array;
    append?: boolean;
}

export interface ListDirectoryArgs {
    path: string;
}

export interface ListDirectoryResult {
    files: string[];
}

export interface HeadlessComputer {
    execute(args: ExecuteArgs): Promise<ExecutionResult>;
    readFile(args: ReadFileArgs): Promise<ReadFileResult>;
    writeFile(args: WriteFileArgs): Promise<{ success: boolean }>;
    listDirectory(args: ListDirectoryArgs): Promise<ListDirectoryResult>;
    getUserId(): Promise<{ userId: string }>;
    getGroupId(): Promise<{ groupId: string }>;
}

export interface CaptureScreenshotArgs {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
}

export interface CaptureScreenshotResult {
    imageData: Uint8Array;
}

export interface ClickArgs {
    x: number;
    y: number;
    button?: string;
}

export interface TypeArgs {
    text: string;
}

export interface KeyArgs {
    key: string;
}

export interface DragArgs {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
}

export interface MoveMouseToArgs {
    x: number;
    y: number;
}

export interface ScrollArgs {
    dx: number;
    dy: number;
}

export interface SetClipboardArgs {
    text: string;
}

export interface ScreenSizeResult {
    width: number;
    height: number;
}

export interface GraphicalComputer extends HeadlessComputer {
    captureScreenshot(args?: CaptureScreenshotArgs): Promise<CaptureScreenshotResult>;
    click(args: ClickArgs): Promise<{ success: boolean }>;
    type(args: TypeArgs): Promise<{ success: boolean }>;
    pressKey(args: KeyArgs): Promise<{ success: boolean }>;
    releaseKey(args: KeyArgs): Promise<{ success: boolean }>;
    pressAndHoldKey(args: KeyArgs): Promise<{ success: boolean }>;
    releaseAllKeys(): Promise<{ success: boolean }>;
    drag(args: DragArgs): Promise<{ success: boolean }>;
    moveMouseTo(args: MoveMouseToArgs): Promise<{ success: boolean }>;
    scroll(args: ScrollArgs): Promise<{ success: boolean }>;
    getClipboard(): Promise<{ text: string }>;
    setClipboard(args: SetClipboardArgs): Promise<{ success: boolean }>;
    getScreenSize(): Promise<ScreenSizeResult>;
}
