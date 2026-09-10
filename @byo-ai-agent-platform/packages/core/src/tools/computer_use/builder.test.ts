import { describe, expect, it, vi } from "vitest";
import { buildComputerTools, createGraphicalTools, createHeadlessTools } from "./builder";
import { GraphicalComputer, HeadlessComputer } from "./computer";

describe("computer tool builder", () => {
    const mockHeadlessComputer: HeadlessComputer = {
        execute: vi.fn().mockResolvedValue({ exitCode: 0, stdout: "output", stderr: "" }),
        readFile: vi.fn().mockResolvedValue({ content: new Uint8Array([65, 66]) }),
        writeFile: vi.fn().mockResolvedValue({ success: true }),
        listDirectory: vi.fn().mockResolvedValue({ files: ["a.txt"] }),
        getUserId: vi.fn().mockResolvedValue({ userId: "1001" }),
        getGroupId: vi.fn().mockResolvedValue({ groupId: "1001" }),
    };

    const mockGraphicalComputer: GraphicalComputer = {
        ...mockHeadlessComputer,
        captureScreenshot: vi.fn().mockResolvedValue({ imageData: new Uint8Array([0, 1]) }),
        click: vi.fn().mockResolvedValue({ success: true }),
        type: vi.fn().mockResolvedValue({ success: true }),
        pressKey: vi.fn().mockResolvedValue({ success: true }),
        releaseKey: vi.fn().mockResolvedValue({ success: true }),
        pressAndHoldKey: vi.fn().mockResolvedValue({ success: true }),
        releaseAllKeys: vi.fn().mockResolvedValue({ success: true }),
        drag: vi.fn().mockResolvedValue({ success: true }),
        moveMouseTo: vi.fn().mockResolvedValue({ success: true }),
        scroll: vi.fn().mockResolvedValue({ success: true }),
        getClipboard: vi.fn().mockResolvedValue({ text: "copied" }),
        setClipboard: vi.fn().mockResolvedValue({ success: true }),
        getScreenSize: vi.fn().mockResolvedValue({ width: 1920, height: 1080 }),
    };

    it("createHeadlessTools creates 6 tools and delegates calls", async () => {
        const tools = createHeadlessTools(mockHeadlessComputer);
        expect(tools).toHaveLength(6);

        const execTool = tools.find((t) => t.name === "execute")!;
        const res = await execTool.execute({ command: "ls" });
        expect(res).toEqual({ exitCode: 0, stdout: "output", stderr: "" });
        expect(mockHeadlessComputer.execute).toHaveBeenCalledWith({
            command: "ls",
            cwd: undefined,
            envVars: undefined,
            stdin: undefined,
            shell: undefined,
            shellArgs: undefined,
        });
    });

    it("createGraphicalTools creates 13 graphical tools and delegates calls", async () => {
        const tools = createGraphicalTools(mockGraphicalComputer);
        expect(tools).toHaveLength(13);

        const clickTool = tools.find((t) => t.name === "click")!;
        const clickRes = await clickTool.execute({ x: 10, y: 20 });
        expect(clickRes).toEqual({ success: true });
        expect(mockGraphicalComputer.click).toHaveBeenCalledWith({ x: 10, y: 20, button: undefined });
    });

    it("buildComputerTools combines headless and graphical tools when isGraphical is true", () => {
        const headlessTools = buildComputerTools(mockHeadlessComputer, false);
        expect(headlessTools).toHaveLength(6);

        const graphicalTools = buildComputerTools(mockGraphicalComputer, true);
        expect(graphicalTools).toHaveLength(19);
    });
});
