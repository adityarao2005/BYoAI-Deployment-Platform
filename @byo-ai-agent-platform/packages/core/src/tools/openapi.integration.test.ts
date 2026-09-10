import express from "express";
import { AddressInfo } from "node:net";
import { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OpenAPIToolProvider } from "./openapi";

describe("OpenAPIToolProvider Integration Suite", () => {
    let server: Server;
    let specUrl: string;
    let lastReceivedPetQuery: string | undefined;

    beforeAll(async () => {
        const app = express();
        app.use(express.json());

        // OpenAPI Specification Endpoint
        app.get("/openapi.json", (_, res) => {
            const address = server.address() as AddressInfo;
            res.json({
                openapi: "3.1.0",
                info: { title: "Test Integration API", version: "1.0.0" },
                servers: [{ url: `http://127.0.0.1:${address.port}` }],
                paths: {
                    "/pets": {
                        get: {
                            operationId: "listPets",
                            summary: "List pets",
                            parameters: [
                                { name: "limit", in: "query", schema: { type: "integer" } },
                            ],
                            responses: { "200": { description: "OK" } },
                        },
                        post: {
                            operationId: "createPet",
                            summary: "Create pet",
                            requestBody: {
                                required: true,
                                content: {
                                    "application/json": {
                                        schema: {
                                            type: "object",
                                            properties: {
                                                name: { type: "string" },
                                                kind: { type: "string" },
                                            },
                                            required: ["name"],
                                        },
                                    },
                                },
                            },
                            responses: { "201": { description: "Created" } },
                        },
                    },
                    "/pets/{id}": {
                        get: {
                            operationId: "getPetById",
                            summary: "Get pet by ID",
                            parameters: [
                                { name: "id", in: "path", required: true, schema: { type: "string" } },
                            ],
                            responses: { "200": { description: "OK" } },
                        },
                    },
                    "/error-endpoint": {
                        get: {
                            operationId: "getError",
                            summary: "Get error",
                            responses: { "400": { description: "Bad Request" } },
                        },
                    },
                    "/auth/apikey-header": {
                        get: {
                            operationId: "checkApiKeyHeader",
                            summary: "Check API Key in Header",
                            responses: { "200": { description: "OK" } },
                        },
                    },
                    "/auth/apikey-query": {
                        get: {
                            operationId: "checkApiKeyQuery",
                            summary: "Check API Key in Query",
                            responses: { "200": { description: "OK" } },
                        },
                    },
                    "/auth/apikey-cookie": {
                        get: {
                            operationId: "checkApiKeyCookie",
                            summary: "Check API Key in Cookie",
                            responses: { "200": { description: "OK" } },
                        },
                    },
                    "/auth/bearer": {
                        get: {
                            operationId: "checkBearerAuth",
                            summary: "Check Bearer Token Auth",
                            responses: { "200": { description: "OK" } },
                        },
                    },
                    "/auth/basic": {
                        get: {
                            operationId: "checkBasicAuth",
                            summary: "Check Basic Auth",
                            responses: { "200": { description: "OK" } },
                        },
                    },
                    "/auth/custom": {
                        get: {
                            operationId: "checkCustomAuth",
                            summary: "Check Custom Auth",
                            responses: { "200": { description: "OK" } },
                        },
                    },
                },
            });
        });

        // Endpoint Handlers
        app.get("/pets", (req, res) => {
            lastReceivedPetQuery = req.query.limit as string | undefined;
            res.json([
                { id: "1", name: "Fluffy", kind: "cat" },
                { id: "2", name: "Spot", kind: "dog" },
            ]);
        });

        app.get("/pets/:id", (req, res) => {
            res.json({ id: req.params.id, name: "Mittens", kind: "cat" });
        });

        app.post("/pets", (req, res) => {
            res.status(201).json({ id: "pet-99", ...req.body });
        });

        app.get("/error-endpoint", (req, res) => {
            res.status(400).json({ message: "Invalid parameter value" });
        });

        // Auth Endpoint Handlers
        app.get("/auth/apikey-header", (req, res) => {
            const key = req.headers["x-api-key"];
            if (key === "secret-header-key") {
                res.json({ authenticated: true, method: "apiKey-header" });
            } else {
                res.status(401).json({ authenticated: false, message: "Invalid API key header" });
            }
        });

        app.get("/auth/apikey-query", (req, res) => {
            const key = req.query["api_key"];
            if (key === "secret-query-key") {
                res.json({ authenticated: true, method: "apiKey-query" });
            } else {
                res.status(401).json({ authenticated: false, message: "Invalid API key query parameter" });
            }
        });

        app.get("/auth/apikey-cookie", (req, res) => {
            const cookie = req.headers["cookie"];
            if (cookie === "session=secret-cookie-key") {
                res.json({ authenticated: true, method: "apiKey-cookie" });
            } else {
                res.status(401).json({ authenticated: false, message: "Invalid API key cookie" });
            }
        });

        app.get("/auth/bearer", (req, res) => {
            const authHeader = req.headers["authorization"];
            if (authHeader === "Bearer secret-bearer-token-123") {
                res.json({ authenticated: true, method: "bearerToken" });
            } else {
                res.status(401).json({ authenticated: false, message: "Invalid Bearer token" });
            }
        });

        app.get("/auth/basic", (req, res) => {
            const authHeader = req.headers["authorization"];
            const expected = "Basic " + Buffer.from("admin:password123").toString("base64");
            if (authHeader === expected) {
                res.json({ authenticated: true, method: "basicAuth" });
            } else {
                res.status(401).json({ authenticated: false, message: "Invalid Basic credentials" });
            }
        });

        app.get("/auth/custom", (req, res) => {
            const headerVal = req.headers["x-custom-auth"];
            const queryVal = req.query["custom_key"];
            if (headerVal === "custom-header-val" && queryVal === "custom-query-val") {
                res.json({ authenticated: true, method: "custom" });
            } else {
                res.status(401).json({ authenticated: false, message: "Invalid custom auth" });
            }
        });

        server = await new Promise(resolve => {
            const s = app.listen(0, () => resolve(s));
        });

        const address = server.address() as AddressInfo;
        specUrl = `http://127.0.0.1:${address.port}/openapi.json`;
    });

    afterAll(async () => {
        if (server) {
            await new Promise<void>(resolve => server.close(() => resolve()));
        }
    });

    it("discovers all registered tools from OpenAPI spec", async () => {
        const provider = new OpenAPIToolProvider({
            name: "discovery-provider",
            type: "openapi",
            specUrl,
            securityVariables: { type: "bearerToken", token: "dummy" },
        });

        const tools = await provider.getAllTools();
        const toolNames = tools.map(t => t.name).sort();

        expect(toolNames).toEqual([
            "discovery-provider_checkApiKeyCookie",
            "discovery-provider_checkApiKeyHeader",
            "discovery-provider_checkApiKeyQuery",
            "discovery-provider_checkBasicAuth",
            "discovery-provider_checkBearerAuth",
            "discovery-provider_checkCustomAuth",
            "discovery-provider_createPet",
            "discovery-provider_getError",
            "discovery-provider_getPetById",
            "discovery-provider_listPets",
        ]);
    });

    it("executes GET requests with query parameters", async () => {
        const provider = new OpenAPIToolProvider({
            name: "query-provider",
            type: "openapi",
            specUrl,
            securityVariables: { type: "bearerToken", token: "dummy" },
        });

        const listTool = await provider.getToolByName("query-provider_listPets");
        expect(listTool).not.toBeNull();

        const result = await listTool!.execute({ limit: 25 });
        expect(result).toEqual([
            { id: "1", name: "Fluffy", kind: "cat" },
            { id: "2", name: "Spot", kind: "dog" },
        ]);
        expect(lastReceivedPetQuery).toBe("25");
    });

    it("executes GET requests with path parameters", async () => {
        const provider = new OpenAPIToolProvider({
            name: "path-provider",
            type: "openapi",
            specUrl,
            securityVariables: { type: "bearerToken", token: "dummy" },
        });

        const getPetTool = await provider.getToolByName("path-provider_getPetById");
        expect(getPetTool).not.toBeNull();

        const result = await getPetTool!.execute({ id: "pet-42" });
        expect(result).toEqual({ id: "pet-42", name: "Mittens", kind: "cat" });
    });

    it("executes POST requests with JSON request body", async () => {
        const provider = new OpenAPIToolProvider({
            name: "post-provider",
            type: "openapi",
            specUrl,
            securityVariables: { type: "bearerToken", token: "dummy" },
        });

        const createTool = await provider.getToolByName("post-provider_createPet");
        expect(createTool).not.toBeNull();

        const result = await createTool!.execute({ name: "Rex", kind: "dog" });
        expect(result).toEqual({ id: "pet-99", name: "Rex", kind: "dog" });
    });

    it("handles HTTP error responses by throwing descriptive errors", async () => {
        const provider = new OpenAPIToolProvider({
            name: "error-provider",
            type: "openapi",
            specUrl,
            securityVariables: { type: "bearerToken", token: "dummy" },
        });

        const errorTool = await provider.getToolByName("error-provider_getError");
        expect(errorTool).not.toBeNull();

        await expect(errorTool!.execute({})).rejects.toThrow("HTTP 400 Bad Request");
    });

    it("supports apiKey authentication in headers", async () => {
        const provider = new OpenAPIToolProvider({
            name: "apikey-header-provider",
            type: "openapi",
            specUrl,
            securityVariables: {
                type: "apiKey",
                key: "secret-header-key",
                name: "x-api-key",
                location: "header",
            },
        });

        const tool = await provider.getToolByName("apikey-header-provider_checkApiKeyHeader");
        expect(tool).not.toBeNull();

        const result = await tool!.execute({});
        expect(result).toEqual({ authenticated: true, method: "apiKey-header" });
    });

    it("supports apiKey authentication in query parameters", async () => {
        const provider = new OpenAPIToolProvider({
            name: "apikey-query-provider",
            type: "openapi",
            specUrl,
            securityVariables: {
                type: "apiKey",
                key: "secret-query-key",
                name: "api_key",
                location: "query",
            },
        });

        const tool = await provider.getToolByName("apikey-query-provider_checkApiKeyQuery");
        expect(tool).not.toBeNull();

        const result = await tool!.execute({});
        expect(result).toEqual({ authenticated: true, method: "apiKey-query" });
    });

    it("supports apiKey authentication in cookies", async () => {
        const provider = new OpenAPIToolProvider({
            name: "apikey-cookie-provider",
            type: "openapi",
            specUrl,
            securityVariables: {
                type: "apiKey",
                key: "secret-cookie-key",
                name: "session",
                location: "cookie",
            },
        });

        const tool = await provider.getToolByName("apikey-cookie-provider_checkApiKeyCookie");
        expect(tool).not.toBeNull();

        const result = await tool!.execute({});
        expect(result).toEqual({ authenticated: true, method: "apiKey-cookie" });
    });

    it("supports Bearer token authentication", async () => {
        const provider = new OpenAPIToolProvider({
            name: "bearer-provider",
            type: "openapi",
            specUrl,
            securityVariables: {
                type: "bearerToken",
                token: "secret-bearer-token-123",
            },
        });

        const tool = await provider.getToolByName("bearer-provider_checkBearerAuth");
        expect(tool).not.toBeNull();

        const result = await tool!.execute({});
        expect(result).toEqual({ authenticated: true, method: "bearerToken" });
    });

    it("supports Basic authentication (header location)", async () => {
        const provider = new OpenAPIToolProvider({
            name: "basic-provider",
            type: "openapi",
            specUrl,
            securityVariables: {
                type: "basicAuth",
                username: "admin",
                password: "password123",
                location: "header",
            },
        });

        const tool = await provider.getToolByName("basic-provider_checkBasicAuth");
        expect(tool).not.toBeNull();

        const result = await tool!.execute({});
        expect(result).toEqual({ authenticated: true, method: "basicAuth" });
    });

    it("supports custom header and query parameter security configuration", async () => {
        const provider = new OpenAPIToolProvider({
            name: "custom-auth-provider",
            type: "openapi",
            specUrl,
            securityVariables: {
                type: "custom",
                headers: { "x-custom-auth": "custom-header-val" },
                queryParams: { custom_key: "custom-query-val" },
                pathParams: {},
            },
        });

        const tool = await provider.getToolByName("custom-auth-provider_checkCustomAuth");
        expect(tool).not.toBeNull();

        const result = await tool!.execute({});
        expect(result).toEqual({ authenticated: true, method: "custom" });
    });
});
