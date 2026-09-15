
// client factories

import type { Agent } from "@/agents";
import type { McpRemoteConfig } from "@/config";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { McpClientFactory } from "./provider";

// remote mcp client factory
export class RemoteMcpClientFactory implements McpClientFactory {
    readonly name: string

    constructor(
        private config: McpRemoteConfig,
        private version?: string,
        private description?: string,
    ) {
        this.name = config.name
    }

    async createClient(agent: Agent): Promise<Client> {
        const client = new Client({
            name: this.name,
            version: this.version ?? "1.0.0",
            description: this.description
        })

        const transport = new StreamableHTTPClientTransport(new URL(this.config.url))

        await client.connect(transport)

        return client
    }
}