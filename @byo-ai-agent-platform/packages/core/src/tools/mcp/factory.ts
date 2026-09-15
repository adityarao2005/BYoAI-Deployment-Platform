import fs from "node:fs/promises";
import {
    Client,
    StreamableHTTPClientTransport,
    type StreamableHTTPClientTransportOptions,
} from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import type { Agent } from "@/agents";
import type { ComputerProvider } from "@/computer";
import type { McpComputerConfig, McpRemoteConfig, McpStdioConfig } from "@/config";
import type { McpClientFactory } from "./provider";

export async function loadCertOrContent(
    pathOrContent: string,
): Promise<string> {
    try {
        return await fs.readFile(pathOrContent, "utf-8");
    } catch {
        return pathOrContent;
    }
}

// remote mcp client factory
export class StreamableHTTPMcpClientFactory implements McpClientFactory {
    readonly name: string;

    constructor(
        private config: McpRemoteConfig,
        private version?: string,
        private description?: string,
    ) {
        this.name = config.name;
    }

    private async buildTransportOptions(): Promise<StreamableHTTPClientTransportOptions> {
        const headers: Record<string, string> = {
            ...(this.config.security?.headers ?? {}),
        };

        const auth = this.config.security?.auth;
        if (auth?.type === "basic") {
            const credentials = Buffer.from(
                `${auth.username}:${auth.password}`,
            ).toString("base64");
            headers["Authorization"] = `Basic ${credentials}`;
        }

        const requestInit: RequestInit & { tls?: Record<string, any> } = {
            headers,
        };

        // mTLS configuration
        if (this.config.security?.mtls) {
            const { clientCert, clientKey, caCert } = this.config.security.mtls;
            requestInit.tls = {
                cert: await loadCertOrContent(clientCert),
                ...(clientKey
                    ? { key: await loadCertOrContent(clientKey) }
                    : {}),
                ...(caCert ? { ca: await loadCertOrContent(caCert) } : {}),
            };
        }

        const transportOptions: StreamableHTTPClientTransportOptions = {
            requestInit,
            authProvider:
                auth?.type === "bearer"
                    ? { token: async () => auth.token }
                    : undefined,
        };

        return transportOptions;
    }

    async createClient(_agent: Agent): Promise<Client> {
        const client = new Client({
            name: this.name,
            version: this.version ?? "1.0.0",
            description: this.description,
        });

        const transportOptions = await this.buildTransportOptions();
        const transport = new StreamableHTTPClientTransport(
            new URL(this.config.url),
            transportOptions,
        );

        await client.connect(transport);

        return client;
    }
}

// stdio mcp client factory (basic stdio)
export class StdioMcpClientFactory implements McpClientFactory {
    readonly name: string;

    constructor(
        private config: McpStdioConfig,
        private version?: string,
        private description?: string,
    ) {
        this.name = config.name;
    }

    async createClient(_agent: Agent): Promise<Client> {
        const client = new Client({
            name: this.name,
            version: this.version ?? "1.0.0",
            description: this.description,
        });

        const transport = new StdioClientTransport({
            command: this.config.command,
            args: this.config.args,
            cwd: this.config.cwd,
            env: this.config.env,
        });

        await client.connect(transport);

        return client;
    }
}

import { ComputerStdioClientTransport } from "./computer_transport";

// computer use stdio mcp client factory
export class ComputerUseStdioMcpClientFactory implements McpClientFactory {
    readonly name: string;

    constructor(
        private config: McpComputerConfig,
        private computerProvider: ComputerProvider,
        private version?: string,
        private description?: string,
    ) {
        this.name = config.name;
    }

    async createClient(agent: Agent): Promise<Client> {
        if (!agent.computerId) {
            throw new Error(
                `Agent ${agent.name} needs to have a computer to use this MCP server`,
            );
        }

        const client = new Client({
            name: this.name,
            version: this.version ?? "1.0.0",
            description: this.description,
        });

        const payload = await this.computerProvider.getComputer(
            agent.computerId,
        );
        if ("error" in payload || !payload.computer) {
            throw new Error(
                `Failed to get computer for agent '${agent.id}' (computerId '${agent.computerId}'): ${"error" in payload ? payload.error : "computer not found"}`,
            );
        }

        const transport = new ComputerStdioClientTransport(
            payload.computer,
            this.config,
        );

        await client.connect(transport);

        return client;
    }
}
