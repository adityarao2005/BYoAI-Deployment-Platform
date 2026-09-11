import { beforeEach, describe, expect, it, mock } from "bun:test";
import { RemoteComputerUseToolProvider } from "./remote_provider";
import { ComputerType } from "@/gen/computer_api/v1/computer_pb";
import type { RemoteComputerUseToolProviderConfig } from "@/config/tool_config";
import { Agent } from "@/agents";

const mockTransport = {};
mock.module("@connectrpc/connect-node", () => ({
    createConnectTransport: mock(() => mockTransport),
}));

const mockComputerProviderClient = {
    createComputer: mock(),
    getComputerInfo: mock(),
};

const mockBasicComputerClient = {
    execute: mock(),
    readFile: mock(),
    writeFile: mock(),
    listDirectory: mock(),
    getUserId: mock(),
    getGroupId: mock(),
};

const mockGraphicalComputerClient = {
    captureScreenshot: mock(),
    click: mock(),
    type: mock(),
    pressKey: mock(),
    releaseKey: mock(),
    pressAndHoldKey: mock(),
    releaseAllKeys: mock(),
    drag: mock(),
    moveMouseTo: mock(),
    scroll: mock(),
    getClipboard: mock(),
    setClipboard: mock(),
    getScreenSize: mock(),
};

mock.module("@connectrpc/connect", () => ({
    createClient: mock((service: any) => {
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
}));

const vi = {
    fn: mock,
    clearAllMocks: () => {
        for (const m of Object.values(mockComputerProviderClient)) (m as any).mockClear?.();
        for (const m of Object.values(mockBasicComputerClient)) (m as any).mockClear?.();
        for (const m of Object.values(mockGraphicalComputerClient)) (m as any).mockClear?.();
    },
};

describe("RemoteComputerUseToolProvider", () => {
    const remoteConfig: RemoteComputerUseToolProviderConfig = {
        type: "remote",
        url: "http://localhost:8080",
        image: "ubuntu:latest",
        enableGUIToolsIfAvailable: true,
        envFile: "",
    };


    const agent = new Agent("test-agent", {
        execute: async (_) => {
            // dummy model.. doesn't matter to us
            return []
        }
    }, [], [])

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
        const execRes = await execTool!.execute({ command: "echo hello" }, agent);
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
        const readRes = await readFileTool!.execute({ path: "/tmp/foo.txt" }, agent);
        expect(readRes).toEqual({ content: new Uint8Array([1, 2, 3]) });

        const writeFileTool = await provider.getToolByName("write_file");
        const writeRes = await writeFileTool!.execute({ path: "/tmp/foo.txt", content: "bar" }, agent);
        expect(writeRes).toEqual({ success: true });

        const listDirTool = await provider.getToolByName("list_directory");
        const listRes = await listDirTool!.execute({ path: "/tmp" }, agent);
        expect(listRes).toEqual({ files: ["file1.txt", "file2.txt"] });

        const userIdTool = await provider.getToolByName("get_user_id");
        const userRes = await userIdTool!.execute({}, agent);
        expect(userRes).toEqual({ userId: "1000" });

        const groupIdTool = await provider.getToolByName("get_group_id");
        const groupRes = await groupIdTool!.execute({}, agent);
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
        const clickRes = await clickTool!.execute({ x: 100, y: 200, button: "left" }, agent);
        expect(clickRes).toEqual({ success: true });
        expect(mockGraphicalComputerClient.click).toHaveBeenCalledWith({
            sessionId: "session-456",
            x: 100,
            y: 200,
            button: "left",
        });

        const screenshotTool = await provider.getToolByName("capture_screenshot");
        const screenshotRes = await screenshotTool!.execute({}, agent);
        expect(screenshotRes).toEqual({ imageData: new Uint8Array([255, 0, 0]) });

        const screenSizeTool = await provider.getToolByName("get_screen_size");
        const screenSizeRes = await screenSizeTool!.execute({}, agent);
        expect(screenSizeRes).toEqual({ width: 1920, height: 1080 });
    });

    it("passes environment and resources to createComputer RPC", async () => {
        mockComputerProviderClient.createComputer.mockResolvedValueOnce({
            result: { case: "sessionId", value: "session-env-1" },
        });
        mockComputerProviderClient.getComputerInfo.mockResolvedValueOnce({
            type: ComputerType.HEADLESS,
        });

        const configWithEnv: RemoteComputerUseToolProviderConfig = {
            ...remoteConfig,
            resources: {
                cpu: "2",
                memory: "1GiB",
            },
            environment: {
                FOO: "bar",
                OVERRIDE_ME: "explicit_val",
            },
        };

        const provider = new RemoteComputerUseToolProvider(configWithEnv);
        await provider.createTools();

        expect(mockComputerProviderClient.createComputer).toHaveBeenCalledWith({
            image: "ubuntu:latest",
            resources: { cpu: "2", memory: "1GiB" },
            environment: { FOO: "bar", OVERRIDE_ME: "explicit_val" },
        });
    });

    it("configures apiKey interceptor and mTLS nodeOptions on transport with full chain fallback", async () => {
        const { createConnectTransport } = await import("@connectrpc/connect-node");

        mockComputerProviderClient.createComputer.mockResolvedValueOnce({
            result: { case: "sessionId", value: "session-sec-1" },
        });
        mockComputerProviderClient.getComputerInfo.mockResolvedValueOnce({
            type: ComputerType.HEADLESS,
        });

        const configWithSecurity: RemoteComputerUseToolProviderConfig = {
            ...remoteConfig,
            security: {
                apiKey: "secret-key-xyz",
                mtls: {
                    clientCert: "sample-cert-content",
                    clientKey: "sample-key-content",
                },
            },
        };

        const provider = new RemoteComputerUseToolProvider(configWithSecurity);
        await provider.createTools();

        expect(createConnectTransport).toHaveBeenCalledWith(
            expect.objectContaining({
                baseUrl: "http://localhost:8080",
                httpVersion: "2",
                interceptors: expect.any(Array),
                nodeOptions: {
                    cert: "sample-cert-content",
                    key: "sample-key-content",
                    ca: "sample-cert-content",
                },
            })
        );
    });

    it("configures mTLS nodeOptions with distinct clientKey and caCert", async () => {
        const { createConnectTransport } = await import("@connectrpc/connect-node");

        mockComputerProviderClient.createComputer.mockResolvedValueOnce({
            result: { case: "sessionId", value: "session-sec-2" },
        });
        mockComputerProviderClient.getComputerInfo.mockResolvedValueOnce({
            type: ComputerType.HEADLESS,
        });

        const configWithFullMtls: RemoteComputerUseToolProviderConfig = {
            ...remoteConfig,
            security: {
                mtls: {
                    clientCert: "sample-cert-content",
                    clientKey: "sample-key-content",
                    caCert: "sample-ca-content",
                },
            },
        };

        const provider = new RemoteComputerUseToolProvider(configWithFullMtls);
        await provider.createTools();

        expect(createConnectTransport).toHaveBeenCalledWith(
            expect.objectContaining({
                baseUrl: "http://localhost:8080",
                httpVersion: "2",
                nodeOptions: {
                    cert: "sample-cert-content",
                    key: "sample-key-content",
                    ca: "sample-ca-content",
                },
            })
        );
    });
});
