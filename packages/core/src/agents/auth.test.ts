import { describe, expect, it, mock } from "bun:test";
import { InMemoryUserTokenManager } from "./auth";
import { AgentExecutor } from "./agent.executor";
import { InMemoryAgentMemoryManager } from "./memory";
import { InMemoryAgentCommunicator } from "./communication";
import { executeOpenAPIOperation } from "@/tools/openapi/executor";
import { StreamableHTTPMcpClientFactory } from "@/tools/mcp/factory";
import type { AgentConfiguration, AgentSession } from "./agents";
import type { Model } from "@/models/models";

const mockModel: Model = {
    name: "Test",
    execute: async () => [
        {
            type: "message",
            role: "assistant",
            content: "Hello",
        },
    ],
};

describe("UserTokenManager & OAuth2 Token Propagation", () => {
    it("manages user tokens in InMemoryUserTokenManager", async () => {
        const manager = new InMemoryUserTokenManager();
        expect(await manager.getUserToken("user-1")).toBeUndefined();

        await manager.setUserToken("user-1", {
            accessToken: "secret-access-token-123",
        });

        const token = await manager.getUserToken("user-1");
        expect(token).toBeDefined();
        expect(token?.accessToken).toBe("secret-access-token-123");

        await manager.clearUserToken("user-1");
        expect(await manager.getUserToken("user-1")).toBeUndefined();
        manager.destroy();
    });

    it("automatically deletes tokens upon expiration using timers and lazy checks", async () => {
        const manager = new InMemoryUserTokenManager();

        // 1. Expired in the past (lazy check)
        await manager.setUserToken("user-past", {
            accessToken: "old-token",
            expiresAt: Math.floor(Date.now() / 1000) - 100, // 100 seconds ago
        });
        expect(await manager.getUserToken("user-past")).toBeUndefined();

        // 2. Short expiry timer check (50ms in the future)
        const expSeconds = (Date.now() + 50) / 1000;
        await manager.setUserToken("user-timer", {
            accessToken: "short-token",
            expiresAt: expSeconds,
        });

        expect(await manager.getUserToken("user-timer")).toBeDefined();

        // Wait 70ms for timer to trigger
        await new Promise((resolve) => setTimeout(resolve, 70));
        expect(await manager.getUserToken("user-timer")).toBeUndefined();

        manager.destroy();
    });

    it("attaches authContext to AgentSession when userTokenManager is configured", async () => {
        const memoryManager = new InMemoryAgentMemoryManager();
        const communicator = new InMemoryAgentCommunicator();
        const tokenManager = new InMemoryUserTokenManager();

        const agentId = await memoryManager.createAgentMemoryEntry("TestAgent", "user-42");
        await tokenManager.setUserToken("user-42", {
            accessToken: "user-42-token",
        });

        const config: AgentConfiguration = {
            name: "TestAgent",
            description: "Test description",
            model: mockModel,
            skillRepository: [],
            toolProviders: [],
            memoryManager,
            communicator,
            userTokenManager: tokenManager,
        };

        const executor = new AgentExecutor(config);
        const { session } = await executor.createAgentSession(agentId);

        expect(session.userId).toBe("user-42");
        expect(session.authContext).toBeDefined();
        expect(session.authContext?.accessToken).toBe("user-42-token");
    });

    it("propagates OAuth2 access token to OpenAPI request only when security type is oauth2", async () => {
        const originalFetch = globalThis.fetch;
        let capturedHeaders: Record<string, string> = {};

        globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
            capturedHeaders = (init?.headers as Record<string, string>) || {};
            return new Response(JSON.stringify({ success: true }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            });
        }) as typeof fetch;

        try {
            const session: Partial<AgentSession> = {
                authContext: { accessToken: "oauth-user-bearer-token" },
            };

            // 1. With securityVariables set to oauth2
            await executeOpenAPIOperation({
                method: "get",
                pathKey: "/user/profile",
                baseUrl: "https://api.example.com",
                allParams: [],
                bodySchemaObj: null,
                config: {
                    name: "test-api",
                    type: "openapi",
                    specUrl: "https://api.example.com/openapi.json",
                    securityVariables: {
                        type: "oauth2",
                    },
                },
                args: {},
                session: session as AgentSession,
            });

            expect(capturedHeaders["Authorization"]).toBe("Bearer oauth-user-bearer-token");

            // 2. With securityVariables set to bearerToken (static token) -> user token should NOT be propagated
            capturedHeaders = {};
            await executeOpenAPIOperation({
                method: "get",
                pathKey: "/user/profile",
                baseUrl: "https://api.example.com",
                allParams: [],
                bodySchemaObj: null,
                config: {
                    name: "test-api",
                    type: "openapi",
                    specUrl: "https://api.example.com/openapi.json",
                    securityVariables: {
                        type: "bearerToken",
                        token: "static-server-token",
                    },
                },
                args: {},
                session: session as AgentSession,
            });

            expect(capturedHeaders["Authorization"]).toBe("Bearer static-server-token");
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it("propagates OAuth2 token in Remote MCP client factory only when auth type is oauth2", async () => {
        const oauth2Factory = new StreamableHTTPMcpClientFactory({
            name: "remote-mcp",
            type: "mcp",
            transport: "http",
            url: "https://mcp.example.com/sse",
            security: {
                auth: {
                    type: "oauth2",
                },
            },
        });

        const session: Partial<AgentSession> = {
            authContext: { accessToken: "mcp-user-access-token" },
        };

        const transportOpts = await (oauth2Factory as any).buildTransportOptions(session);
        expect(transportOpts.authProvider).toBeDefined();
        const token = await transportOpts.authProvider.token();
        expect(token).toBe("mcp-user-access-token");

        // Non-oauth2 auth type (bearer) should use static token, not session token
        const bearerFactory = new StreamableHTTPMcpClientFactory({
            name: "remote-mcp",
            type: "mcp",
            transport: "http",
            url: "https://mcp.example.com/sse",
            security: {
                auth: {
                    type: "bearer",
                    token: "static-mcp-token",
                },
            },
        });

        const bearerOpts = await (bearerFactory as any).buildTransportOptions(session);
        const bearerToken = await bearerOpts.authProvider.token();
        expect(bearerToken).toBe("static-mcp-token");
    });
});
