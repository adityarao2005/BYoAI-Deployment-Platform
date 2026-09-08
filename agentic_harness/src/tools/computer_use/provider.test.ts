import { describe, expect, it, vi, beforeEach } from "vitest";
import { RemoteComputerUseToolProvider, registerComputerUseToolProvider } from "./provider";
import { ComputerType } from "@/gen/computer_api/v1/computer_pb";
import { toolProviderRegistry } from "../tools";
import { RemoteComputerUseToolProviderConfig } from "@/config/tool_config";

vi.mock("@connectrpc/connect-node", () => ({
    createConnectTransport: vi.fn().mockReturnValue({}),
}));

const mockComputerProviderClient = {
    createComputer: vi.fn(),
    getComputerInfo: vi.fn(),
};

const mockBasicComputerClient = {
    execute: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    listDirectory: vi.fn(),
    getUserId: vi.fn(),
    getGroupId: vi.fn(),
};

const mockGraphicalComputerClient = {
    captureScreenshot: vi.fn(),
    click: vi.fn(),
    type: vi.fn(),
    pressKey: vi.fn(),
    releaseKey: vi.fn(),
    pressAndHoldKey: vi.fn(),
    releaseAllKeys: vi.fn(),
    drag: vi.fn(),
    moveMouseTo: vi.fn(),
    scroll: vi.fn(),
    getClipboard: vi.fn(),
    setClipboard: vi.fn(),
    getScreenSize: vi.fn(),
};

vi.mock("@connectrpc/connect", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@connectrpc/connect")>();
    return {
        ...actual,
        createClient: vi.fn((service: any) => {
            if (service?.typeName === "computer_api.v1.ComputerProviderService") {
                return mockComputerProviderClient;
            }
            if (service?.typeName === "computer_api.v1.BasicComputerService") {
                return mockBasicComputerClient;
            }
            if (service?.typeName === "computer_api.v1.GraphicalComputerService") {
                return mockGraphicalComputerClient;
            }
            return {};
        }),
    };
});

describe("RemoteComputerUseToolProvider", () => {
    const remoteConfig: RemoteComputerUseToolProviderConfig = {
        type: "remote",
        url: "http://localhost:8080",
        image: "ubuntu:latest",
        enableGUIToolsIfAvailable: true,
        envFile: "",
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("creates tools for HEADLESS computer type", async () => {
        mockComputerProviderClient.createComputer.mockResolvedValueOnce({
            result: { case: "sessionId", value: "session-123" },
        });
        mockComputerProviderClient.getComputerInfo.mockResolvedValueOnce({
            type: ComputerType.HEADLESS,
        });

        const provider = new RemoteComputerUseToolProvider(remoteConfig);
        const tools = await provider.getAllTools();

        expect(tools).toHaveLength(6);
        const toolNames = tools.map((t) => t.name);
        expect(toolNames).toEqual([
            "execute",
            "read_file",
            "write_file",
            "list_directory",
            "get_user_id",
            "get_group_id",
        ]);
    });

    it("creates tools for GRAPHICAL computer type", async () => {
        mockComputerProviderClient.createComputer.mockResolvedValueOnce({
            result: { case: "sessionId", value: "session-456" },
        });
        mockComputerProviderClient.getComputerInfo.mockResolvedValueOnce({
            type: ComputerType.GRAPHICAL,
        });

        const provider = new RemoteComputerUseToolProvider(remoteConfig);
        const tools = await provider.getAllTools();

        expect(tools).toHaveLength(19);
        const toolNames = tools.map((t) => t.name);
        expect(toolNames).toContain("capture_screenshot");
        expect(toolNames).toContain("click");
        expect(toolNames).toContain("type");
        expect(toolNames).toContain("get_screen_size");
    });

    it("throws an error when createComputer fails", async () => {
        mockComputerProviderClient.createComputer.mockResolvedValueOnce({
            result: { case: "errorMessage", value: "Failed to allocate container" },
        });

        const provider = new RemoteComputerUseToolProvider(remoteConfig);
        await expect(provider.getAllTools()).rejects.toThrow("Failed to allocate container");
    });

    it("throws an error when getComputerInfo returns UNSPECIFIED", async () => {
        mockComputerProviderClient.createComputer.mockResolvedValueOnce({
            result: { case: "sessionId", value: "session-789" },
        });
        mockComputerProviderClient.getComputerInfo.mockResolvedValueOnce({
            type: ComputerType.UNSPECIFIED,
        });

        const provider = new RemoteComputerUseToolProvider(remoteConfig);
        await expect(provider.getAllTools()).rejects.toThrow("Computer does not exist");
    });

    it("executes basic computer tools correctly", async () => {
        mockComputerProviderClient.createComputer.mockResolvedValueOnce({
            result: { case: "sessionId", value: "session-123" },
        });
        mockComputerProviderClient.getComputerInfo.mockResolvedValueOnce({
            type: ComputerType.HEADLESS,
        });

        mockBasicComputerClient.execute.mockResolvedValueOnce({
            result: { case: "execResult", value: { exitCode: 0, stdout: "hello", stderr: "" } },
        });
        mockBasicComputerClient.readFile.mockResolvedValueOnce({
            result: { case: "content", value: new Uint8Array([1, 2, 3]) },
        });
        mockBasicComputerClient.writeFile.mockResolvedValueOnce({
            result: { case: "resp", value: {} },
        });
        mockBasicComputerClient.listDirectory.mockResolvedValueOnce({
            result: { case: "response", value: { files: ["file1.txt", "file2.txt"] } },
        });
        mockBasicComputerClient.getUserId.mockResolvedValueOnce({
            result: { case: "userId", value: "1000" },
        });
        mockBasicComputerClient.getGroupId.mockResolvedValueOnce({
            result: { case: "groupId", value: "1000" },
        });

        const provider = new RemoteComputerUseToolProvider(remoteConfig);

        const execTool = await provider.getToolByName("execute");
        expect(execTool).toBeDefined();
        const execRes = await execTool!.execute({ command: "echo hello" });
        expect(execRes).toEqual({ exitCode: 0, stdout: "hello", stderr: "" });
        expect(mockBasicComputerClient.execute).toHaveBeenCalledWith({
            sessionId: "session-123",
            command: "echo hello",
            cwd: undefined,
            envVars: {},
            stdin: undefined,
            shell: undefined,
            shellArgs: [],
        });

        const readFileTool = await provider.getToolByName("read_file");
        const readRes = await readFileTool!.execute({ path: "/tmp/foo.txt" });
        expect(readRes).toEqual({ content: new Uint8Array([1, 2, 3]) });

        const writeFileTool = await provider.getToolByName("write_file");
        const writeRes = await writeFileTool!.execute({ path: "/tmp/foo.txt", content: "bar" });
        expect(writeRes).toEqual({ success: true });

        const listDirTool = await provider.getToolByName("list_directory");
        const listRes = await listDirTool!.execute({ path: "/tmp" });
        expect(listRes).toEqual({ files: ["file1.txt", "file2.txt"] });

        const userIdTool = await provider.getToolByName("get_user_id");
        const userRes = await userIdTool!.execute({});
        expect(userRes).toEqual({ userId: "1000" });

        const groupIdTool = await provider.getToolByName("get_group_id");
        const groupRes = await groupIdTool!.execute({});
        expect(groupRes).toEqual({ groupId: "1000" });
    });

    it("executes graphical computer tools correctly", async () => {
        mockComputerProviderClient.createComputer.mockResolvedValueOnce({
            result: { case: "sessionId", value: "session-456" },
        });
        mockComputerProviderClient.getComputerInfo.mockResolvedValueOnce({
            type: ComputerType.GRAPHICAL,
        });

        mockGraphicalComputerClient.click.mockResolvedValueOnce({
            result: { case: "response", value: {} },
        });
        mockGraphicalComputerClient.captureScreenshot.mockResolvedValueOnce({
            result: { case: "response", value: { imageData: new Uint8Array([255, 0, 0]) } },
        });
        mockGraphicalComputerClient.getScreenSize.mockResolvedValueOnce({
            result: { case: "response", value: { width: 1920, height: 1080 } },
        });

        const provider = new RemoteComputerUseToolProvider(remoteConfig);

        const clickTool = await provider.getToolByName("click");
        const clickRes = await clickTool!.execute({ x: 100, y: 200, button: "left" });
        expect(clickRes).toEqual({ success: true });
        expect(mockGraphicalComputerClient.click).toHaveBeenCalledWith({
            sessionId: "session-456",
            x: 100,
            y: 200,
            button: "left",
        });

        const screenshotTool = await provider.getToolByName("capture_screenshot");
        const screenshotRes = await screenshotTool!.execute({});
        expect(screenshotRes).toEqual({ imageData: new Uint8Array([255, 0, 0]) });

        const screenSizeTool = await provider.getToolByName("get_screen_size");
        const screenSizeRes = await screenSizeTool!.execute({});
        expect(screenSizeRes).toEqual({ width: 1920, height: 1080 });
    });
});

describe("registerComputerUseToolProvider", () => {
    it("registers remote computer tool provider into registry", () => {
        const initialCount = toolProviderRegistry.getAllToolProviders().length;

        registerComputerUseToolProvider([
            {
                type: "computer",
                provider: {
                    type: "remote",
                    url: "http://localhost:8080",
                    image: "ubuntu:latest",
                    enableGUIToolsIfAvailable: true,
                    envFile: "",
                },
            },
        ]);

        const providers = toolProviderRegistry.getAllToolProviders();
        expect(providers.length).toBe(initialCount + 1);
    });

    it("throws if more than 1 computer tool provider is provided", () => {
        expect(() =>
            registerComputerUseToolProvider([
                {
                    type: "computer",
                    provider: { type: "local", enableGUIToolsIfAvailable: false },
                },
                {
                    type: "computer",
                    provider: {
                        type: "remote",
                        url: "http://localhost",
                        image: "ubuntu",
                        enableGUIToolsIfAvailable: true,
                        envFile: "",
                    },
                },
            ])
        ).toThrow("There should only be 1 computer use tool provider declared");
    });
});
