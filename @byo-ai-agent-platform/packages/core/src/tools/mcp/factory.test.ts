import { describe, expect, it, mock, beforeEach } from "bun:test";
import { RemoteMcpClientFactory, loadCertOrContent } from "./factory";
import type { McpRemoteConfig } from "@/config";
import type { Agent } from "@/agents";

const mockConnect = mock((_transport: any) => Promise.resolve());

mock.module("@modelcontextprotocol/client", () => {
    class MockClient {
        options: any;
        constructor(options: any) {
            this.options = options;
        }
        async connect(transport: any) {
            return await mockConnect(transport);
        }
    }

    class MockStreamableHTTPClientTransport {
        url: URL;
        opts: any;
        constructor(url: URL, opts: any) {
            this.url = url;
            this.opts = opts;
        }
    }

    return {
        Client: MockClient,
        StreamableHTTPClientTransport: MockStreamableHTTPClientTransport,
    };
});

describe("RemoteMcpClientFactory", () => {
    const dummyAgent: Agent = {
        id: "agent-1",
        name: "test-agent",
    };

    beforeEach(() => {
        mockConnect.mockClear();
    });

    it("creates client with bearer token configured as authProvider", async () => {
        const config: McpRemoteConfig = {
            name: "test-mcp",
            type: "mcp",
            transport: "http",
            url: "http://localhost:8000",
            security: {
                auth: {
                    type: "bearer",
                    token: "secret-bearer-token",
                },
            },
        };

        const factory = new RemoteMcpClientFactory(config);
        const client = await factory.createClient(dummyAgent);

        expect(client).toBeDefined();
        expect(mockConnect).toHaveBeenCalledTimes(1);

        const transport = mockConnect.mock.calls[0]![0] as any;
        expect(transport.url.toString()).toBe("http://localhost:8000/");
        expect(transport.opts.authProvider).toBeDefined();

        const token = await transport.opts.authProvider.token();
        expect(token).toBe("secret-bearer-token");
        expect(transport.opts.requestInit.headers["Authorization"]).toBeUndefined();
    });

    it("creates client with basic auth formatted and encoded in Authorization header", async () => {
        const config: McpRemoteConfig = {
            name: "test-mcp",
            type: "mcp",
            transport: "http",
            url: "http://localhost:8000",
            security: {
                auth: {
                    type: "basic",
                    username: "admin",
                    password: "secret123",
                },
            },
        };

        const factory = new RemoteMcpClientFactory(config);
        await factory.createClient(dummyAgent);

        const transport = mockConnect.mock.calls[0]![0] as any;
        const expectedBase64 = Buffer.from("admin:secret123").toString("base64");
        expect(transport.opts.requestInit.headers["Authorization"]).toBe(`Basic ${expectedBase64}`);
        expect(transport.opts.authProvider).toBeUndefined();
    });

    it("preserves custom headers alongside basic auth", async () => {
        const config: McpRemoteConfig = {
            name: "test-mcp",
            type: "mcp",
            transport: "http",
            url: "http://localhost:8000",
            security: {
                headers: {
                    "X-Custom-Header": "custom-value",
                },
                auth: {
                    type: "basic",
                    username: "user",
                    password: "pass",
                },
            },
        };

        const factory = new RemoteMcpClientFactory(config);
        await factory.createClient(dummyAgent);

        const transport = mockConnect.mock.calls[0]![0] as any;
        expect(transport.opts.requestInit.headers["X-Custom-Header"]).toBe("custom-value");
        expect(transport.opts.requestInit.headers["Authorization"]).toBe(
            `Basic ${Buffer.from("user:pass").toString("base64")}`
        );
    });

    it("configures mTLS tls options with clientCert, clientKey, and caCert", async () => {
        const config: McpRemoteConfig = {
            name: "test-mcp",
            type: "mcp",
            transport: "http",
            url: "https://localhost:8443",
            security: {
                mtls: {
                    clientCert: "-----BEGIN CERTIFICATE-----\nMIIB...\n-----END CERTIFICATE-----",
                    clientKey: "-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----",
                    caCert: "-----BEGIN CERTIFICATE-----\nCA...\n-----END CERTIFICATE-----",
                },
            },
        };

        const factory = new RemoteMcpClientFactory(config);
        await factory.createClient(dummyAgent);

        const transport = mockConnect.mock.calls[0]![0] as any;
        expect(transport.opts.requestInit.tls).toBeDefined();
        expect(transport.opts.requestInit.tls.cert).toContain("-----BEGIN CERTIFICATE-----");
        expect(transport.opts.requestInit.tls.key).toContain("-----BEGIN RSA PRIVATE KEY-----");
        expect(transport.opts.requestInit.tls.ca).toContain("CA...");
    });

    it("loadCertOrContent returns content directly if not a valid file path", async () => {
        const rawContent = "RAW_CERTIFICATE_STRING";
        const res = await loadCertOrContent(rawContent);
        expect(res).toBe(rawContent);
    });
});
