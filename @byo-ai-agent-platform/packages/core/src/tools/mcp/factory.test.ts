import { afterAll, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { Client } from "@modelcontextprotocol/client";
import type { Agent } from "@/agents";
import type { McpRemoteConfig } from "@/config";
import { loadCertOrContent, StreamableHTTPMcpClientFactory } from "./factory";

describe("RemoteMcpClientFactory", () => {
    const dummyAgent: Agent = {
        id: "agent-1",
        name: "test-agent",
    };

    let connectSpy: any;
    let lastTransport: any = null;

    beforeEach(() => {
        lastTransport = null;
        if (connectSpy) connectSpy.mockRestore();
        connectSpy = spyOn(Client.prototype, "connect").mockImplementation(
            async (transport: any) => {
                lastTransport = transport;
            },
        );
    });

    afterAll(() => {
        if (connectSpy) connectSpy.mockRestore();
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

        const factory = new StreamableHTTPMcpClientFactory(config);
        const client = await factory.createClient(dummyAgent);

        expect(client).toBeDefined();
        expect(connectSpy).toHaveBeenCalledTimes(1);

        expect(lastTransport._url.toString()).toBe("http://localhost:8000/");
        expect(lastTransport._authProvider).toBeDefined();

        const token = await lastTransport._authProvider.token();
        expect(token).toBe("secret-bearer-token");
        expect(
            lastTransport._requestInit.headers["Authorization"],
        ).toBeUndefined();
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

        const factory = new StreamableHTTPMcpClientFactory(config);
        await factory.createClient(dummyAgent);

        const expectedBase64 =
            Buffer.from("admin:secret123").toString("base64");
        expect(lastTransport._requestInit.headers["Authorization"]).toBe(
            `Basic ${expectedBase64}`,
        );
        expect(lastTransport._authProvider).toBeUndefined();
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

        const factory = new StreamableHTTPMcpClientFactory(config);
        await factory.createClient(dummyAgent);

        expect(lastTransport._requestInit.headers["X-Custom-Header"]).toBe(
            "custom-value",
        );
        expect(lastTransport._requestInit.headers["Authorization"]).toBe(
            `Basic ${Buffer.from("user:pass").toString("base64")}`,
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
                    clientCert:
                        "-----BEGIN CERTIFICATE-----\nMIIB...\n-----END CERTIFICATE-----",
                    clientKey:
                        "-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----",
                    caCert: "-----BEGIN CERTIFICATE-----\nCA...\n-----END CERTIFICATE-----",
                },
            },
        };

        const factory = new StreamableHTTPMcpClientFactory(config);
        await factory.createClient(dummyAgent);

        expect(lastTransport._requestInit.tls).toBeDefined();
        expect(lastTransport._requestInit.tls.cert).toContain(
            "-----BEGIN CERTIFICATE-----",
        );
        expect(lastTransport._requestInit.tls.key).toContain(
            "-----BEGIN RSA PRIVATE KEY-----",
        );
        expect(lastTransport._requestInit.tls.ca).toContain("CA...");
    });

    it("loadCertOrContent returns content directly if not a valid file path", async () => {
        const rawContent = "RAW_CERTIFICATE_STRING";
        const res = await loadCertOrContent(rawContent);
        expect(res).toBe(rawContent);
    });
});
