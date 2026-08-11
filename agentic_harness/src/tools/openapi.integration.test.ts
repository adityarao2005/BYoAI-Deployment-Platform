import express from "express";
import { Server } from "node:http";
import { describe, expect, it } from "vitest";
import { OpenAPIToolProvider } from "./openapi";

describe("OpenAPIToolProvider Integration with Express Mock Server", () => {
    it("fetches spec from Express server, discovers tools, and executes API requests", async () => {
        let lastReceivedHeader: string | undefined;
        let lastReceivedQuery: string | undefined;
        let lastReceivedBody: any = undefined;

        const app = express();
        app.use(express.json());

        // Serve OpenAPI Specification
        app.get("/openapi.json", (req, res) => {
            const address = server.address() as any;
            res.json({
                openapi: "3.1.0",
                info: { title: "Petstore Service", version: "1.0.0" },
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
                },
            });
        });

        // Express Endpoints
        app.get("/pets", (req, res) => {
            lastReceivedHeader = req.headers["x-api-key"] as string | undefined;
            lastReceivedQuery = req.query.limit as string | undefined;
            res.json([
                { id: "1", name: "Fluffy", kind: "cat" },
                { id: "2", name: "Spot", kind: "dog" },
            ]);
        });

        app.get("/pets/:id", (req, res) => {
            res.json({ id: req.params.id, name: "Mittens", kind: "cat" });
        });

        app.post("/pets", (req, res) => {
            lastReceivedBody = req.body;
            res.status(201).json({ id: "pet-99", ...req.body });
        });

        app.get("/error-endpoint", (req, res) => {
            res.status(400).json({ message: "Invalid parameter value" });
        });

        const server: Server = await new Promise(resolve => {
            const s = app.listen(0, () => resolve(s));
        });

        try {
            const port = (server.address() as any).port;
            const specUrl = `http://127.0.0.1:${port}/openapi.json`;

            const provider = new OpenAPIToolProvider({
                name: "express-petstore",
                type: "openapi",
                specUrl,
                securityVariables: {
                    type: "apiKey",
                    key: "express-secret-key",
                    name: "x-api-key",
                    location: "header",
                },
            });

            // 1. Tool discovery
            const tools = await provider.getAllTools();
            expect(tools.map(t => t.name).sort()).toEqual(["createPet", "getError", "getPetById", "listPets"]);

            // 2. Execute GET /pets with query parameters & security headers
            const listTool = await provider.getToolByName("listPets");
            expect(listTool).not.toBeNull();
            const listResult = await listTool!.execute({ limit: 10 });

            expect(listResult).toEqual([
                { id: "1", name: "Fluffy", kind: "cat" },
                { id: "2", name: "Spot", kind: "dog" },
            ]);
            expect(lastReceivedHeader).toBe("express-secret-key");
            expect(lastReceivedQuery).toBe("10");

            // 3. Execute GET /pets/:id with path parameter
            const getPetTool = await provider.getToolByName("getPetById");
            expect(getPetTool).not.toBeNull();
            const getPetResult = await getPetTool!.execute({ id: "pet-42" });
            expect(getPetResult).toEqual({ id: "pet-42", name: "Mittens", kind: "cat" });

            // 4. Execute POST /pets with request body
            const createTool = await provider.getToolByName("createPet");
            expect(createTool).not.toBeNull();
            const createResult = await createTool!.execute({ name: "Rex", kind: "dog" });
            expect(createResult).toEqual({ id: "pet-99", name: "Rex", kind: "dog" });
            expect(lastReceivedBody).toEqual({ name: "Rex", kind: "dog" });

            // 5. Execute 400 Bad Request error endpoint
            const errorTool = await provider.getToolByName("getError");
            expect(errorTool).not.toBeNull();
            await expect(errorTool!.execute({})).rejects.toThrow("HTTP 400 Bad Request");
        } finally {
            await new Promise<void>(resolve => server.close(() => resolve()));
        }
    });
});
