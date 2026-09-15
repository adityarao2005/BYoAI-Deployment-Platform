import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { McpServer, WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Agent, AgentSession } from "@/agents";
import { McpServerToolProvider } from "./provider";
import { RemoteMcpClientFactory } from "./factory";
import type { McpRemoteConfig } from "@/config";

describe("MCP Integration Test Suite", () => {
    let tempDir: string;
    let caCert: string;
    let caKey: string;
    let serverCert: string;
    let serverKey: string;
    let clientCert: string;
    let clientKey: string;

    const dummyAgent: Agent = {
        id: "integration-agent-1",
        name: "integration-agent",
    };
    const fakeSession = { agent: dummyAgent } as unknown as AgentSession;

    beforeAll(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-test-certs-"));
        const caKeyPath = path.join(tempDir, "ca.key");
        const caCertPath = path.join(tempDir, "ca.crt");
        const serverKeyPath = path.join(tempDir, "server.key");
        const serverCsrPath = path.join(tempDir, "server.csr");
        const serverCertPath = path.join(tempDir, "server.crt");
        const clientKeyPath = path.join(tempDir, "client.key");
        const clientCsrPath = path.join(tempDir, "client.csr");
        const clientCertPath = path.join(tempDir, "client.crt");

        execSync(
            `openssl req -x509 -newkey rsa:2048 -nodes -keyout ${caKeyPath} -out ${caCertPath} -days 1 -subj "/CN=TestCA"`,
            { stdio: "pipe" }
        );
        execSync(
            `openssl req -newkey rsa:2048 -nodes -keyout ${serverKeyPath} -out ${serverCsrPath} -subj "/CN=localhost"`,
            { stdio: "pipe" }
        );
        execSync(
            `openssl x509 -req -in ${serverCsrPath} -CA ${caCertPath} -CAkey ${caKeyPath} -CAcreateserial -out ${serverCertPath} -days 1`,
            { stdio: "pipe" }
        );
        execSync(
            `openssl req -newkey rsa:2048 -nodes -keyout ${clientKeyPath} -out ${clientCsrPath} -subj "/CN=TestClient"`,
            { stdio: "pipe" }
        );
        execSync(
            `openssl x509 -req -in ${clientCsrPath} -CA ${caCertPath} -CAkey ${caKeyPath} -CAcreateserial -out ${clientCertPath} -days 1`,
            { stdio: "pipe" }
        );

        caCert = await fs.readFile(caCertPath, "utf-8");
        caKey = await fs.readFile(caKeyPath, "utf-8");
        serverCert = await fs.readFile(serverCertPath, "utf-8");
        serverKey = await fs.readFile(serverKeyPath, "utf-8");
        clientCert = await fs.readFile(clientCertPath, "utf-8");
        clientKey = await fs.readFile(clientKeyPath, "utf-8");
    });

    afterAll(async () => {
        if (tempDir) {
            await fs.rm(tempDir, { recursive: true, force: true });
        }
    });

    function createDummyMcpServer() {
        const server = new McpServer({
            name: "dummy-test-server",
            version: "1.0.0",
        });

        server.registerTool(
            "calculate_sum",
            {
                description: "Calculates the sum of two numbers",
                inputSchema: {
                    a: z.number().describe("First number"),
                    b: z.number().describe("Second number"),
                },
            },
            async ({ a, b }) => {
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({ sum: a + b }),
                        },
                    ],
                };
            }
        );

        server.registerResource(
            "notes",
            "memo://notes.txt",
            {
                description: "Secret notes resource",
                mimeType: "text/plain",
            },
            async (uri: any) => {
                return {
                    contents: [
                        {
                            uri: uri.toString(),
                            text: "Secret notes content from MCP server",
                        },
                    ],
                };
            }
        );

        return server;
    }

    it("connects with Bearer auth, discovers tools/resources, and executes calls", async () => {
        const expectedToken = "secret-token-12345";
        const mcpServer = createDummyMcpServer();
        const serverTransport = new WebStandardStreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
        });
        await mcpServer.connect(serverTransport);

        const server = Bun.serve({
            port: 0,
            async fetch(req) {
                const authHeader = req.headers.get("Authorization");
                if (authHeader !== `Bearer ${expectedToken}`) {
                    return new Response("Unauthorized", { status: 401 });
                }
                return await serverTransport.handleRequest(req);
            },
        });

        try {
            const config: McpRemoteConfig = {
                name: "bearer_mcp",
                type: "mcp",
                transport: "http",
                url: `http://localhost:${server.port}`,
                security: {
                    auth: {
                        type: "bearer",
                        token: expectedToken,
                    },
                },
            };

            const factory = new RemoteMcpClientFactory(config);
            const provider = new McpServerToolProvider(factory);

            const tools = await provider.getAllTools(dummyAgent);
            expect(tools.length).toBe(3); // calculate_sum, read_resource, list_resources

            const sumTool = await provider.getToolByName("bearer_mcp_tools_calculate_sum", dummyAgent);
            expect(sumTool).not.toBeNull();

            const sumResult = await sumTool!.execute({ a: 15, b: 35 }, fakeSession);
            expect(sumResult).toEqual([
                {
                    type: "text",
                    text: JSON.stringify({ sum: 50 }),
                },
            ]);

            const readTool = await provider.getToolByName("bearer_mcp_read_resource", dummyAgent);
            expect(readTool).not.toBeNull();
            const resourceResult = await readTool!.execute({ uri: "memo://notes.txt" }, fakeSession);
            expect(resourceResult).toEqual([
                {
                    uri: "memo://notes.txt",
                    text: "Secret notes content from MCP server",
                },
            ]);
        } finally {
            server.stop();
        }
    });

    it("rejects Bearer auth request when token is invalid", async () => {
        const expectedToken = "valid-token";
        const mcpServer = createDummyMcpServer();
        const serverTransport = new WebStandardStreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
        });
        await mcpServer.connect(serverTransport);

        const server = Bun.serve({
            port: 0,
            async fetch(req) {
                if (req.headers.get("Authorization") !== `Bearer ${expectedToken}`) {
                    return new Response("Unauthorized", { status: 401 });
                }
                return await serverTransport.handleRequest(req);
            },
        });

        try {
            const config: McpRemoteConfig = {
                name: "bearer_mcp_bad",
                type: "mcp",
                transport: "http",
                url: `http://localhost:${server.port}`,
                security: {
                    auth: {
                        type: "bearer",
                        token: "wrong-token",
                    },
                },
            };

            const factory = new RemoteMcpClientFactory(config);
            const provider = new McpServerToolProvider(factory);

            expect(provider.getAllTools(dummyAgent)).rejects.toThrow();
        } finally {
            server.stop();
        }
    });

    it("connects with Basic auth, discovers tools, and executes calls", async () => {
        const username = "admin";
        const password = "myPassword!";
        const expectedAuthHeader = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;

        const mcpServer = createDummyMcpServer();
        const serverTransport = new WebStandardStreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
        });
        await mcpServer.connect(serverTransport);

        const server = Bun.serve({
            port: 0,
            async fetch(req) {
                const authHeader = req.headers.get("Authorization");
                if (authHeader !== expectedAuthHeader) {
                    return new Response("Unauthorized", { status: 401 });
                }
                return await serverTransport.handleRequest(req);
            },
        });

        try {
            const config: McpRemoteConfig = {
                name: "basic_mcp",
                type: "mcp",
                transport: "http",
                url: `http://localhost:${server.port}`,
                security: {
                    auth: {
                        type: "basic",
                        username,
                        password,
                    },
                },
            };

            const factory = new RemoteMcpClientFactory(config);
            const provider = new McpServerToolProvider(factory);

            const tools = await provider.getAllTools(dummyAgent);
            const sumTool = tools.find((t) => t.name === "basic_mcp_tools_calculate_sum");
            expect(sumTool).toBeDefined();

            const sumResult = await sumTool!.execute({ a: 7, b: 8 }, fakeSession);
            expect(sumResult).toEqual([
                {
                    type: "text",
                    text: JSON.stringify({ sum: 15 }),
                },
            ]);
        } finally {
            server.stop();
        }
    });

    it("transmits custom headers correctly to the MCP server", async () => {
        let receivedTenantHeader: string | null = null;

        const mcpServer = createDummyMcpServer();
        const serverTransport = new WebStandardStreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
        });
        await mcpServer.connect(serverTransport);

        const server = Bun.serve({
            port: 0,
            async fetch(req) {
                receivedTenantHeader = req.headers.get("X-Tenant-ID");
                if (receivedTenantHeader !== "acme-corp") {
                    return new Response("Forbidden Tenant", { status: 403 });
                }
                return await serverTransport.handleRequest(req);
            },
        });

        try {
            const config: McpRemoteConfig = {
                name: "header_mcp",
                type: "mcp",
                transport: "http",
                url: `http://localhost:${server.port}`,
                security: {
                    headers: {
                        "X-Tenant-ID": "acme-corp",
                    },
                },
            };

            const factory = new RemoteMcpClientFactory(config);
            const provider = new McpServerToolProvider(factory);

            const tools = await provider.getAllTools(dummyAgent);
            expect(tools.length).toBeGreaterThan(0);
            expect(String(receivedTenantHeader)).toBe("acme-corp");
        } finally {
            server.stop();
        }
    });

    it("connects and executes over mutual TLS (mTLS)", async () => {
        const mcpServer = createDummyMcpServer();
        const serverTransport = new WebStandardStreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
        });
        await mcpServer.connect(serverTransport);

        const server = Bun.serve({
            port: 0,
            tls: {
                cert: serverCert,
                key: serverKey,
                ca: caCert,
                requestCert: true,
                rejectUnauthorized: true,
            },
            async fetch(req) {
                return await serverTransport.handleRequest(req);
            },
        });

        try {
            const config: McpRemoteConfig = {
                name: "mtls_mcp",
                type: "mcp",
                transport: "http",
                url: `https://localhost:${server.port}`,
                security: {
                    mtls: {
                        clientCert,
                        clientKey,
                        caCert,
                    },
                },
            };

            const factory = new RemoteMcpClientFactory(config);
            const provider = new McpServerToolProvider(factory);

            const tools = await provider.getAllTools(dummyAgent);
            const sumTool = tools.find((t) => t.name === "mtls_mcp_tools_calculate_sum");
            expect(sumTool).toBeDefined();

            const sumResult = await sumTool!.execute({ a: 100, b: 200 }, fakeSession);
            expect(sumResult).toEqual([
                {
                    type: "text",
                    text: JSON.stringify({ sum: 300 }),
                },
            ]);
        } finally {
            server.stop();
        }
    });
});
