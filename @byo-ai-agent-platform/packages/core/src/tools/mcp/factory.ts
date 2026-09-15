import fs from "node:fs/promises";
import type { Agent } from "@/agents";
import type { McpRemoteConfig } from "@/config";
import {
    Client,
    StreamableHTTPClientTransport,
    type StreamableHTTPClientTransportOptions,
} from "@modelcontextprotocol/client";
import type { McpClientFactory } from "./provider";

export async function loadCertOrContent(pathOrContent: string): Promise<string> {
    try {
        return await fs.readFile(pathOrContent, "utf-8");
    } catch {
        return pathOrContent;
    }
}

// remote mcp client factory
export class RemoteMcpClientFactory implements McpClientFactory {
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
            const credentials = Buffer.from(`${auth.username}:${auth.password}`).toString("base64");
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
                ...(clientKey ? { key: await loadCertOrContent(clientKey) } : {}),
                ...(caCert ? { ca: await loadCertOrContent(caCert) } : {}),
            };
        }

        const transportOptions: StreamableHTTPClientTransportOptions = {
            requestInit,
            authProvider: auth?.type === "bearer" ? { token: async () => auth.token } : undefined,
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
        const transport = new StreamableHTTPClientTransport(new URL(this.config.url), transportOptions);

        await client.connect(transport);

        return client;
    }
}