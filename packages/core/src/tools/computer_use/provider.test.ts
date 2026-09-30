import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { AgentHandle } from "@/agents";
import type {
    ComputerProvider,
    GraphicalComputer,
    HeadlessComputer,
} from "@/computer/computer";
import { ComputerType } from "@/gen/computer_api/v1/computer_pb";
import { ComputerUseToolProvider } from "./provider";

const vi = { fn: mock };

function createAgent(computerId?: string): AgentHandle {
    return {
        id: "test-agent",
        name: "test-agent",
        userId: "user-1",
        computerId,
    };
}

describe("ComputerUseToolProvider", () => {
    let mockHeadlessComputer: HeadlessComputer;
    let mockGraphicalComputer: GraphicalComputer;
    let mockProvider: ComputerProvider;

    beforeEach(() => {
        mockHeadlessComputer = {
            execute: vi
                .fn()
                .mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" }),
            executeStream: vi.fn().mockResolvedValue({} as any),
            readFile: vi.fn().mockResolvedValue({ content: new Uint8Array() }),
            writeFile: vi.fn().mockResolvedValue({ success: true }),
            listDirectory: vi.fn().mockResolvedValue({ files: [] }),
            getUserId: vi.fn().mockResolvedValue({ userId: "1000" }),
            getGroupId: vi.fn().mockResolvedValue({ groupId: "1000" }),
        };

        mockGraphicalComputer = {
            ...mockHeadlessComputer,
            captureScreenshot: vi
                .fn()
                .mockResolvedValue({ imageData: new Uint8Array() }),
            click: vi.fn().mockResolvedValue({ success: true }),
            type: vi.fn().mockResolvedValue({ success: true }),
            pressKey: vi.fn().mockResolvedValue({ success: true }),
            releaseKey: vi.fn().mockResolvedValue({ success: true }),
            pressAndHoldKey: vi.fn().mockResolvedValue({ success: true }),
            releaseAllKeys: vi.fn().mockResolvedValue({ success: true }),
            drag: vi.fn().mockResolvedValue({ success: true }),
            moveMouseTo: vi.fn().mockResolvedValue({ success: true }),
            scroll: vi.fn().mockResolvedValue({ success: true }),
            getClipboard: vi.fn().mockResolvedValue({ text: "" }),
            setClipboard: vi.fn().mockResolvedValue({ success: true }),
            getScreenSize: vi
                .fn()
                .mockResolvedValue({ width: 1920, height: 1080 }),
        };

        mockProvider = {
            init: vi.fn().mockResolvedValue(undefined),
            createComputer: vi.fn().mockResolvedValue("comp-123"),
            deleteComputer: vi.fn().mockResolvedValue(undefined),
            getComputer: vi.fn(),
        };
    });

    it("throws an error when agent does not have a computerId", async () => {
        const agent = createAgent();
        const toolProvider = new ComputerUseToolProvider(mockProvider);

        expect(toolProvider.getAllTools(agent)).rejects.toThrow(
            "The Agent is not registered with this tool provider and thus the agent does not have a computer id",
        );
    });

    it("throws an error when getComputer returns UNSPECIFIED", async () => {
        const agent = createAgent("comp-123");
        (mockProvider.getComputer as any).mockResolvedValueOnce({
            type: ComputerType.UNSPECIFIED,
            error: "Something went wrong",
        });

        const toolProvider = new ComputerUseToolProvider(mockProvider);
        expect(toolProvider.getAllTools(agent)).rejects.toThrow(
            "Something went wrong when trying to retrieve the computer, please check the computer provider logs",
        );
    });

    it("creates 6 headless tools for HEADLESS computer type", async () => {
        const agent = createAgent("comp-123");
        (mockProvider.getComputer as any).mockResolvedValueOnce({
            type: ComputerType.HEADLESS,
            computer: mockHeadlessComputer,
        });

        const toolProvider = new ComputerUseToolProvider(mockProvider);
        const tools = await toolProvider.getAllTools(agent);

        expect(tools).toHaveLength(6);
        const toolNames = tools.map((t) => t.name);
        expect(toolNames).toContain("execute");
        expect(toolNames).toContain("read_file");
        expect(toolNames).toContain("write_file");
        expect(toolNames).toContain("list_directory");
        expect(toolNames).toContain("get_user_id");
        expect(toolNames).toContain("get_group_id");
    });

    it("creates 19 tools for GRAPHICAL computer type (headless + graphical)", async () => {
        const agent = createAgent("comp-123");
        (mockProvider.getComputer as any).mockResolvedValueOnce({
            type: ComputerType.GRAPHICAL,
            computer: mockGraphicalComputer,
        });

        const toolProvider = new ComputerUseToolProvider(mockProvider);
        const tools = await toolProvider.getAllTools(agent);

        expect(tools).toHaveLength(19);
        const toolNames = tools.map((t) => t.name);
        expect(toolNames).toContain("execute");
        expect(toolNames).toContain("click");
        expect(toolNames).toContain("capture_screenshot");
        expect(toolNames).toContain("get_screen_size");
    });

    it("caches tools per agent so getComputer is not invoked repeatedly", async () => {
        const agent = createAgent("comp-123");
        (mockProvider.getComputer as any).mockResolvedValueOnce({
            type: ComputerType.HEADLESS,
            computer: mockHeadlessComputer,
        });

        const toolProvider = new ComputerUseToolProvider(mockProvider);
        const firstTools = await toolProvider.getAllTools(agent);
        const secondTools = await toolProvider.getAllTools(agent);

        expect(firstTools).toBe(secondTools);
        expect(mockProvider.getComputer).toHaveBeenCalledTimes(1);
    });

    it("returns tool by name with getToolByName", async () => {
        const agent = createAgent("comp-123");
        (mockProvider.getComputer as any).mockResolvedValueOnce({
            type: ComputerType.HEADLESS,
            computer: mockHeadlessComputer,
        });

        const toolProvider = new ComputerUseToolProvider(mockProvider);
        const execTool = await toolProvider.getToolByName("execute", agent);
        expect(execTool).toBeDefined();
        expect(execTool?.name).toBe("execute");

        const nonExistent = await toolProvider.getToolByName(
            "non_existent",
            agent,
        );
        expect(nonExistent).toBeNull();
    });

    it("enforces read, write, and execute permissions on computer tools", async () => {
        const agent = createAgent("comp-123");
        (mockProvider.getComputer as any).mockResolvedValue({
            type: ComputerType.HEADLESS,
            computer: mockHeadlessComputer,
        });

        const toolProvider = new ComputerUseToolProvider(mockProvider, {
            read: {
                allowed: ["/workspace", "/tmp/*"],
                disallowed: ["/etc/*"],
            },
            write: {
                allowed: ["/workspace/*"],
                disallowed: ["/workspace/secret.key"],
            },
            execute: {
                disallowed: ["bash", "sh", "git commit*"],
            },
        });

        const tools = await toolProvider.getAllTools(agent);
        const executeTool = tools.find((t) => t.name === "execute")!;
        const readFileTool = tools.find((t) => t.name === "read_file")!;
        const writeFileTool = tools.find((t) => t.name === "write_file")!;
        const listDirTool = tools.find((t) => t.name === "list_directory")!;

        // 1. Execute tests
        await expect(executeTool.execute({ command: "bash script.sh" }, {} as any)).rejects.toThrow(
            /Permission denied: Command execution 'bash script\.sh' is disallowed/,
        );
        await expect(executeTool.execute({ command: "git commit -m 'test'" }, {} as any)).rejects.toThrow(
            /Permission denied: Command execution 'git commit -m 'test'' is disallowed/,
        );
        await expect(executeTool.execute({ command: "ls -la" }, {} as any)).resolves.toBeDefined();

        // 2. Read tests
        await expect(readFileTool.execute({ path: "/etc/passwd" }, {} as any)).rejects.toThrow(
            /Permission denied: read access to '\/etc\/passwd' is disallowed/,
        );
        await expect(readFileTool.execute({ path: "/var/secret" }, {} as any)).rejects.toThrow(
            /Permission denied: read access to '\/var\/secret' is disallowed/,
        );
        await expect(readFileTool.execute({ path: "/workspace/main.ts" }, {} as any)).resolves.toBeDefined();
        await expect(listDirTool.execute({ path: "/etc/nginx" }, {} as any)).rejects.toThrow(
            /Permission denied: read access to '\/etc\/nginx' is disallowed/,
        );
        await expect(listDirTool.execute({ path: "/workspace" }, {} as any)).resolves.toBeDefined();

        // 3. Write tests
        await expect(writeFileTool.execute({ path: "/workspace/secret.key", content: "bad" }, {} as any)).rejects.toThrow(
            /Permission denied: write access to '\/workspace\/secret\.key' is disallowed/,
        );
        await expect(writeFileTool.execute({ path: "/tmp/not-allowed.txt", content: "bad" }, {} as any)).rejects.toThrow(
            /Permission denied: write access to '\/tmp\/not-allowed\.txt' is disallowed/,
        );
        await expect(writeFileTool.execute({ path: "/workspace/output.txt", content: "ok" }, {} as any)).resolves.toBeDefined();
    });
});
