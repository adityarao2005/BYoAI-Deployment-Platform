import { beforeEach, describe, expect, it, mock } from "bun:test";
import { RemoteComputerProvider } from "./remote_provider";
import { ComputerType } from "@/gen/computer_api/v1/computer_pb";
import type { RemoteComputerUseToolProviderConfig } from "@/config/tool_config";

const mockTransport = {};
mock.module("@connectrpc/connect-node", () => ({
    createConnectTransport: mock(() => mockTransport),
}));

const mockComputerProviderClient = {
    createComputer: mock(),
    deleteComputer: mock(),
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

describe("RemoteComputerProvider", () => {
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

    it("creates computer and returns sessionId", async () => {
        mockComputerProviderClient.createComputer.mockResolvedValueOnce({
            result: { case: "sessionId", value: "session-123" },
        });

        const provider = new RemoteComputerProvider(remoteConfig);
        await provider.init();
        const sessionId = await provider.createComputer();

        expect(sessionId).toBe("session-123");
    });

    it("throws an error when createComputer returns errorMessage", async () => {
        mockComputerProviderClient.createComputer.mockResolvedValueOnce({
            result: { case: "errorMessage", value: "Failed to allocate container" },
        });

        const provider = new RemoteComputerProvider(remoteConfig);
        await provider.init();
        await expect(provider.createComputer()).rejects.toThrow("Failed to allocate container");
    });

    it("deletes computer by sessionId", async () => {
        mockComputerProviderClient.deleteComputer.mockResolvedValueOnce({});

        const provider = new RemoteComputerProvider(remoteConfig);
        await provider.init();
        await provider.deleteComputer("session-123");

        expect(mockComputerProviderClient.deleteComputer).toHaveBeenCalledWith({
            sessionId: "session-123",
        });
    });

    it("returns HEADLESS computer payload and executes operations", async () => {
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
            result: { case: "response", value: { files: ["file1.txt"] } },
        });
        mockBasicComputerClient.getUserId.mockResolvedValueOnce({
            result: { case: "userId", value: "1000" },
        });
        mockBasicComputerClient.getGroupId.mockResolvedValueOnce({
            result: { case: "groupId", value: "1000" },
        });

        const provider = new RemoteComputerProvider(remoteConfig);
        await provider.init();

        const payload = await provider.getComputer("session-123");
        expect(payload.type).toBe(ComputerType.HEADLESS);

        if (payload.type === ComputerType.HEADLESS) {
            const execRes = await payload.computer.execute({ command: "echo hello" });
            expect(execRes).toEqual({ exitCode: 0, stdout: "hello", stderr: "" });

            const readRes = await payload.computer.readFile({ path: "/tmp/foo.txt" });
            expect(readRes).toEqual({ content: new Uint8Array([1, 2, 3]) });

            const writeRes = await payload.computer.writeFile({ path: "/tmp/foo.txt", content: new Uint8Array([97]) });
            expect(writeRes).toEqual({ success: true });

            const listRes = await payload.computer.listDirectory({ path: "/tmp" });
            expect(listRes).toEqual({ files: ["file1.txt"] });

            const userRes = await payload.computer.getUserId();
            expect(userRes).toEqual({ userId: "1000" });

            const groupRes = await payload.computer.getGroupId();
            expect(groupRes).toEqual({ groupId: "1000" });
        }
    });

    it("returns GRAPHICAL computer payload and executes graphical operations", async () => {
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

        const provider = new RemoteComputerProvider(remoteConfig);
        await provider.init();

        const payload = await provider.getComputer("session-456");
        expect(payload.type).toBe(ComputerType.GRAPHICAL);

        if (payload.type === ComputerType.GRAPHICAL) {
            const clickRes = await payload.computer.click({ x: 100, y: 200, button: "left" });
            expect(clickRes).toEqual({ success: true });

            const shotRes = await payload.computer.captureScreenshot();
            expect(shotRes).toEqual({ imageData: new Uint8Array([255, 0, 0]) });

            const sizeRes = await payload.computer.getScreenSize();
            expect(sizeRes).toEqual({ width: 1920, height: 1080 });
        }
    });

    it("returns error payload when getComputer returns UNSPECIFIED", async () => {
        mockComputerProviderClient.getComputerInfo.mockResolvedValueOnce({
            type: ComputerType.UNSPECIFIED,
        });

        const provider = new RemoteComputerProvider(remoteConfig);
        await provider.init();

        const payload = await provider.getComputer("session-789");
        expect(payload.type).toBe(ComputerType.UNSPECIFIED);
    });

    it("passes environment and resources to createComputer RPC", async () => {
        mockComputerProviderClient.createComputer.mockResolvedValueOnce({
            result: { case: "sessionId", value: "session-env-1" },
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

        const provider = new RemoteComputerProvider(configWithEnv);
        await provider.init();
        await provider.createComputer();

        expect(mockComputerProviderClient.createComputer).toHaveBeenCalledWith({
            image: "ubuntu:latest",
            resources: { cpu: "2", memory: "1GiB" },
            environment: { FOO: "bar", OVERRIDE_ME: "explicit_val" },
        });
    });

    it("configures apiKey interceptor and mTLS nodeOptions on transport with full chain fallback", async () => {
        const { createConnectTransport } = await import("@connectrpc/connect-node");

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

        const provider = new RemoteComputerProvider(configWithSecurity);
        await provider.init();

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

        const provider = new RemoteComputerProvider(configWithFullMtls);
        await provider.init();

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
