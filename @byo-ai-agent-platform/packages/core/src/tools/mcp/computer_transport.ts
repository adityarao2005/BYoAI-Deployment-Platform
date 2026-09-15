import type { JSONRPCMessage, Transport } from "@modelcontextprotocol/client";
import type { HeadlessComputer, StreamSession } from "@/computer/computer";
import type { McpComputerConfig, McpStdioConfig } from "@/config/tool_config";

/**
 * Custom MCP Transport that executes MCP servers inside the agent's computer
 * (local host or remote container via gRPC) and relays JSON-RPC over stdin/stdout streaming.
 */
export class ComputerStdioClientTransport implements Transport {
    private session: StreamSession | null = null;
    onclose?: () => void;
    onerror?: (error: Error) => void;
    onmessage?: (message: JSONRPCMessage) => void;

    constructor(
        private computer: HeadlessComputer,
        private config: McpComputerConfig,
    ) {}

    /**
     * Starts the interactive command execution on the computer and attaches JSON-RPC stream handlers.
     */
    async start(): Promise<void> {
        if (this.session) {
            throw new Error("ComputerStdioClientTransport is already started");
        }

        const fullCommand = [
            this.config.command,
            ...(this.config.args || []),
        ].join(" ");
        this.session = await this.computer.executeStream({
            command: fullCommand,
            cwd: this.config.cwd,
            envVars: this.config.env,
        });

        let readBuffer = "";

        this.session.onStdout((chunk: Uint8Array) => {
            readBuffer += new TextDecoder().decode(chunk);
            const lines = readBuffer.split("\n");
            // Retain uncompleted fragment in buffer
            readBuffer = lines.pop() ?? "";

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                try {
                    const message = JSON.parse(trimmed) as JSONRPCMessage;
                    this.onmessage?.(message);
                } catch (err: unknown) {
                    const message = err instanceof Error ? err.message : String(err);
                    this.onerror?.(
                        new Error(
                            `Failed to parse MCP JSON-RPC line: ${message}`,
                        ),
                    );
                }
            }
        });

        this.session.onStderr((chunk: Uint8Array) => {
            const stderrStr = new TextDecoder().decode(chunk);
            console.warn(`[ComputerStdioClientTransport stderr]: ${stderrStr}`);
        });

        this.session.onExit((code: number) => {
            if (code !== 0) {
                this.onerror?.(
                    new Error(
                        `MCP server process exited with non-zero exit code ${code}`,
                    ),
                );
            }
            this.onclose?.();
        });

        this.session.onError((err: Error) => {
            this.onerror?.(err);
        });
    }

    /**
     * Sends a JSON-RPC message to the remote/local process stdin.
     */
    async send(message: JSONRPCMessage): Promise<void> {
        if (!this.session) {
            throw new Error("ComputerStdioClientTransport is not started");
        }
        const jsonLine = `${JSON.stringify(message)}\n`;
        await this.session.writeStdin(jsonLine);
    }

    /**
     * Closes the transport and terminates the interactive session on the computer.
     */
    async close(): Promise<void> {
        if (this.session) {
            const currentSession = this.session;
            this.session = null;
            await currentSession.closeStdin().catch(() => {});
            await currentSession.kill().catch(() => {});
        }
        this.onclose?.();
    }
}
