import { describe, expect, it, beforeEach, afterEach, spyOn } from "bun:test";
import { ERR_GRAPHICS_UNSUPPORTED, LocalComputer, LocalComputerProvider, LocalGraphicalComputer } from "./local_provider";
import { ComputerType } from "@/gen/computer_api/v1/computer_pb";

const vi = { spyOn, restoreAllMocks: () => { } };
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";

describe("LocalComputer", () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "local-computer-test-"));
    });

    afterEach(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it("executes shell commands cleanly", async () => {
        const computer = new LocalComputer();
        const result = await computer.execute({
            command: "echo 'hello from local computer'",
        });

        expect(result.exitCode).toBe(0);
        expect(result.stdout.trim()).toBe("hello from local computer");
    });

    it("supports write, read, and list operations on files", async () => {
        const computer = new LocalComputer();
        const testFile = path.join(tmpDir, "test.txt");

        const writeRes = await computer.writeFile({
            path: testFile,
            content: "Hello World!",
        });
        expect(writeRes).toEqual({ success: true });

        const readRes = await computer.readFile({
            path: testFile,
        });
        expect(new TextDecoder().decode(readRes.content)).toBe("Hello World!");

        const offsetRead = await computer.readFile({
            path: testFile,
            offset: 6,
            limit: 5,
        });
        expect(new TextDecoder().decode(offsetRead.content)).toBe("World");

        const listRes = await computer.listDirectory({ path: tmpDir });
        expect(listRes.files).toContain("test.txt");
    });

    it("returns user and group IDs", async () => {
        const computer = new LocalComputer();
        const userRes = await computer.getUserId();
        const groupRes = await computer.getGroupId();

        expect(userRes.userId).toBeDefined();
        expect(groupRes.groupId).toBeDefined();
    });
});

describe("LocalGraphicalComputer", () => {
    const originalDisplay = process.env.DISPLAY;
    const originalWayland = process.env.WAYLAND_DISPLAY;

    afterEach(() => {
        if (originalDisplay !== undefined) {
            process.env.DISPLAY = originalDisplay;
        } else {
            delete process.env.DISPLAY;
        }
        if (originalWayland !== undefined) {
            process.env.WAYLAND_DISPLAY = originalWayland;
        } else {
            delete process.env.WAYLAND_DISPLAY;
        }
        vi.restoreAllMocks();
    });

    it("throws graphics unsupported when DISPLAY is unset", async () => {
        delete process.env.DISPLAY;
        delete process.env.WAYLAND_DISPLAY;

        const computer = new LocalGraphicalComputer();
        expect(computer.supportsGraphics()).toBe(false);

        await expect(computer.click({ x: 10, y: 10 })).rejects.toThrow(ERR_GRAPHICS_UNSUPPORTED);
        await expect(computer.captureScreenshot()).rejects.toThrow(ERR_GRAPHICS_UNSUPPORTED);
    });

    it("executes graphical actions when DISPLAY is set and tools exist", async () => {
        process.env.DISPLAY = ":0";
        const computer = new LocalGraphicalComputer();

        // Spy on internal runCommand logic or mock spawn for CLI interactions
        const runCommandSpy = vi.spyOn(computer as any, "runCommand").mockImplementation(async (cmd: any, args: any, stdin?: any) => {
            if (cmd === "xdotool" && args[0] === "getdisplaygeometry") {
                return Buffer.from("1920 1080\n");
            }
            if (cmd === "xclip" && args.includes("-o")) {
                return Buffer.from("copied clip text");
            }
            if (cmd === "maim") {
                return Buffer.from([137, 80, 78, 71]); // PNG magic bytes
            }
            return Buffer.from("");
        });

        const clickRes = await computer.click({ x: 100, y: 200, button: "left" });
        expect(clickRes).toEqual({ success: true });
        expect(runCommandSpy).toHaveBeenCalledWith("xdotool", ["mousemove", "--sync", "100", "200", "click", "1"]);

        const typeRes = await computer.type({ text: "hello" });
        expect(typeRes).toEqual({ success: true });

        const pressRes = await computer.pressKey({ key: "Return" });
        expect(pressRes).toEqual({ success: true });

        const releaseRes = await computer.releaseKey({ key: "Return" });
        expect(releaseRes).toEqual({ success: true });

        const sizeRes = await computer.getScreenSize();
        expect(sizeRes).toEqual({ width: 1920, height: 1080 });

        const clipRes = await computer.getClipboard();
        expect(clipRes).toEqual({ text: "copied clip text" });

        const shotRes = await computer.captureScreenshot();
        expect(shotRes.imageData).toEqual(new Uint8Array([137, 80, 78, 71]));
    });
});

describe("LocalComputerProvider", () => {
    const originalDisplay = process.env.DISPLAY;
    const originalWayland = process.env.WAYLAND_DISPLAY;

    afterEach(() => {
        if (originalDisplay !== undefined) {
            process.env.DISPLAY = originalDisplay;
        } else {
            delete process.env.DISPLAY;
        }
        if (originalWayland !== undefined) {
            process.env.WAYLAND_DISPLAY = originalWayland;
        } else {
            delete process.env.WAYLAND_DISPLAY;
        }
    });

    it("creates HEADLESS computer when GUI is disabled or unsupported", async () => {
        delete process.env.DISPLAY;
        delete process.env.WAYLAND_DISPLAY;

        const provider = new LocalComputerProvider({
            type: "local",
            enableGUIToolsIfAvailable: false,
        });

        const computerId = await provider.createComputer();
        const payload = await provider.getComputer(computerId);

        expect(payload.type).toBe(ComputerType.HEADLESS);
    });

    it("creates GRAPHICAL computer when GUI is enabled and DISPLAY is set", async () => {
        process.env.DISPLAY = ":0";

        const provider = new LocalComputerProvider({
            type: "local",
            enableGUIToolsIfAvailable: true,
        });

        const computerId = await provider.createComputer();
        const payload = await provider.getComputer(computerId);

        expect(payload.type).toBe(ComputerType.GRAPHICAL);
    });

    it("deletes computer and returns error for nonexistent computerId", async () => {
        const provider = new LocalComputerProvider({
            type: "local",
            enableGUIToolsIfAvailable: false,
        });

        const computerId = await provider.createComputer();
        await provider.deleteComputer(computerId);

        const payload = await provider.getComputer(computerId);
        expect(payload.type).toBe(ComputerType.UNSPECIFIED);
    });
});
