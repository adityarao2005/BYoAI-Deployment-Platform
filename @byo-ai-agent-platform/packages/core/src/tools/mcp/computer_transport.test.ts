import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { Client } from "@modelcontextprotocol/client";
import type { Agent } from "@/agents";
import type {
    ComputerPayload,
    ComputerProvider,
    HeadlessComputer,
    StreamSession,
} from "@/computer/computer";
import type { McpStdioConfig } from "@/config";
import { ComputerType } from "@/gen/computer_api/v1/computer_pb";
import { ComputerStdioClientTransport } from "./computer_transport";
import { ComputerUseStdioMcpClientFactory } from "./factory";

describe("ComputerStdioClientTransport", () => {
    let mockSession: StreamSession;
    let stdoutCallback: ((chunk: Uint8Array) => void) | null = null;
    let stderrCallback: ((chunk: Uint8Array) => void) | null = null;
    let exitCallback: ((code: number) => void) | null = null;
    let errorCallback: ((error: Error) => void) | null = null;
    let writtenStdin: (Uint8Array | string)[] = [];
    let closedStdin = false;
    let killed = false;

    let mockComputer: HeadlessComputer;

    beforeEach(() => {
        stdoutCallback = null;
        stderrCallback = null;
        exitCallback = null;
        errorCallback = null;
        writtenStdin = [];
        closedStdin = false;
        killed = false;

        mockSession = {
            writeStdin: mock(async (data: Uint8Array | string) => {
                writtenStdin.push(data);
            }),
            closeStdin: mock(async () => {
                closedStdin = true;
            }),
            onStdout: mock((listener) => {
                stdoutCallback = listener;
            }),
            onStderr: mock((listener) => {
                stderrCallback = listener;
            }),
            onExit: mock((listener) => {
                exitCallback = listener;
            }),
            onError: mock((listener) => {
                errorCallback = listener;
            }),
            wait: mock(async () => 0),
            kill: mock(async () => {
                killed = true;
            }),
        };

        mockComputer = {
            execute: mock(async () => ({
                exitCode: 0,
                stdout: "",
                stderr: "",
            })),
            executeStream: mock(async () => mockSession),
            readFile: mock(async () => ({ content: new Uint8Array() })),
            writeFile: mock(async () => ({ success: true })),
            listDirectory: mock(async () => ({ files: [] })),
            getUserId: mock(async () => ({ userId: "1000" })),
            getGroupId: mock(async () => ({ groupId: "1000" })),
        };
    });

    const mcpConfig: McpStdioConfig = {
        name: "test-computer-mcp",
        type: "mcp",
        transport: "stdio",
        command: "npx",
        args: ["@modelcontextprotocol/server-filesystem", "/tmp"],
        env: { FOO: "BAR" },
    };

    it("starts execution session on the computer with full command and environment", async () => {
        const transport = new ComputerStdioClientTransport(
            mockComputer,
            mcpConfig,
        );
        await transport.start();

        expect(mockComputer.executeStream).toHaveBeenCalledWith({
            command: "npx @modelcontextprotocol/server-filesystem /tmp",
            cwd: undefined,
            envVars: { FOO: "BAR" },
        });
    });

    it("serializes and sends JSON-RPC messages to stdin", async () => {
        const transport = new ComputerStdioClientTransport(
            mockComputer,
            mcpConfig,
        );
        await transport.start();

        const jsonMsg = {
            jsonrpc: "2.0" as const,
            id: 1,
            method: "tools/list",
            params: {},
        };
        await transport.send(jsonMsg);

        expect(writtenStdin).toHaveLength(1);
        expect(writtenStdin[0]).toBe(`${JSON.stringify(jsonMsg)}\n`);
    });

    it("buffers stdout chunks and emits parsed JSON-RPC messages via onmessage", async () => {
        const transport = new ComputerStdioClientTransport(
            mockComputer,
            mcpConfig,
        );
        const receivedMessages: any[] = [];
        transport.onmessage = (msg) => receivedMessages.push(msg);

        await transport.start();

        const msg1 = { jsonrpc: "2.0", id: 1, result: { tools: [] } };
        const msg2 = { jsonrpc: "2.0", id: 2, result: { content: "ok" } };

        // Send stdout data in partial chunks
        const text = `${JSON.stringify(msg1)}\n${JSON.stringify(msg2)}\n`;
        const encoder = new TextEncoder();
        const chunk1 = encoder.encode(text.slice(0, 15));
        const chunk2 = encoder.encode(text.slice(15));

        stdoutCallback?.(chunk1);
        expect(receivedMessages).toHaveLength(0); // incomplete line buffered

        stdoutCallback?.(chunk2);
        expect(receivedMessages).toHaveLength(2);
        expect(receivedMessages[0]).toEqual(msg1);
        expect(receivedMessages[1]).toEqual(msg2);
    });

    it("triggers onclose when process exits", async () => {
        const transport = new ComputerStdioClientTransport(
            mockComputer,
            mcpConfig,
        );
        let closed = false;
        transport.onclose = () => {
            closed = true;
        };

        await transport.start();
        exitCallback?.(0);

        expect(closed).toBe(true);
    });

    it("closes stdin and kills session on transport close", async () => {
        const transport = new ComputerStdioClientTransport(
            mockComputer,
            mcpConfig,
        );
        await transport.start();
        await transport.close();

        expect(closedStdin).toBe(true);
        expect(killed).toBe(true);
    });
});

describe("ComputerUseStdioMcpClientFactory", () => {
    it("retrieves agent computer and connects ComputerStdioClientTransport", async () => {
        const agent: Agent = {
            id: "agent-1",
            name: "test-agent",
            computerId: "comp-999",
        };

        const mockSession: StreamSession = {
            writeStdin: mock(async () => {}),
            closeStdin: mock(async () => {}),
            onStdout: mock(() => {}),
            onStderr: mock(() => {}),
            onExit: mock(() => {}),
            onError: mock(() => {}),
            wait: mock(async () => 0),
            kill: mock(async () => {}),
        };

        const mockComputer: HeadlessComputer = {
            execute: mock(async () => ({
                exitCode: 0,
                stdout: "",
                stderr: "",
            })),
            executeStream: mock(async () => mockSession),
            readFile: mock(async () => ({ content: new Uint8Array() })),
            writeFile: mock(async () => ({ success: true })),
            listDirectory: mock(async () => ({ files: [] })),
            getUserId: mock(async () => ({ userId: "1000" })),
            getGroupId: mock(async () => ({ groupId: "1000" })),
        };

        const mockProvider: ComputerProvider = {
            init: mock(async () => {}),
            createComputer: mock(async () => "comp-999"),
            deleteComputer: mock(async () => {}),
            getComputer: mock(
                async (): Promise<ComputerPayload> => ({
                    type: ComputerType.HEADLESS,
                    computer: mockComputer,
                }),
            ),
        };

        const mcpConfig: McpStdioConfig = {
            name: "fs-mcp",
            type: "mcp",
            transport: "stdio",
            command: "npx",
            args: ["@modelcontextprotocol/server-filesystem", "/tmp"],
        };

        const connectSpy = spyOn(Client.prototype, "connect").mockImplementation(async () => {});

        const factory = new ComputerUseStdioMcpClientFactory(
            mcpConfig,
            mockProvider,
        );

        const client = await factory.createClient(agent);
        expect(client).toBeDefined();
        expect(mockProvider.getComputer).toHaveBeenCalledWith("comp-999");
        expect(connectSpy).toHaveBeenCalled();
        connectSpy.mockRestore();
    });
});
