import { describe, expect, it } from "vitest";
import { normalizeOpenAPIDocument } from "./openapi";

const petSchema = {
    type: "object",
    properties: {
        id: { type: "string" },
        name: { type: "string" },
    },
    required: ["id", "name"],
};

const openApi30Document = {
    openapi: "3.0.3",
    info: {
        title: "Pets API",
        version: "1.0.0",
    },
    paths: {
        "/pets": {
            get: {
                responses: {
                    "200": {
                        description: "ok",
                        content: {
                            "application/json": {
                                schema: { $ref: "#/components/schemas/Pet" },
                            },
                        },
                    },
                },
            },
        },
    },
    components: {
        schemas: {
            Pet: petSchema,
        },
    },
};

const openApi31Document = {
    openapi: "3.1.0",
    info: {
        title: "Pets API",
        version: "1.0.0",
    },
    paths: {
        "/pets": {
            get: {
                responses: {
                    "200": {
                        description: "ok",
                        content: {
                            "application/json": {
                                schema: { $ref: "#/components/schemas/Pet" },
                            },
                        },
                    },
                },
            },
        },
    },
    components: {
        schemas: {
            Pet: petSchema,
        },
    },
};

const swaggerDocument = {
    swagger: "2.0",
    info: {
        title: "Pets API",
        version: "1.0.0",
    },
    paths: {
        "/pets": {
            get: {
                responses: {
                    "200": {
                        description: "ok",
                        schema: { $ref: "#/definitions/Pet" },
                    },
                },
            },
        },
    },
    definitions: {
        Pet: petSchema,
    },
};

describe.each([
    ["OpenAPI 3.0", openApi30Document],
    ["OpenAPI 3.1", openApi31Document],
    ["Swagger 2.0", swaggerDocument],
])("normalizeOpenAPIDocument with %s input", (_, document) => {
    it("upgrades and dereferences the document in memory", async () => {
        const schema = await normalizeOpenAPIDocument(document);
        const typedSchema = schema as Record<string, any>;

        expect(typedSchema.openapi).toMatch(/^3\.1/);

        const responseSchema =
            typedSchema.paths["/pets"].get.responses["200"].content["application/json"].schema;

        expect(responseSchema).toMatchObject(petSchema);
        expect(responseSchema).not.toHaveProperty("$ref");
    });
});

import { OpenAPIToolProviderConfig } from "@/config/tool_config";
import { buildToolsFromSpec, convertOpenAPISchemaToToolArgument, OpenAPIToolProvider, registerOpenAPIToolProviders } from "./openapi";
import { toolProviderRegistry } from "./tools";

describe("convertOpenAPISchemaToToolArgument", () => {
    it("converts primitive schema types correctly", () => {
        expect(convertOpenAPISchemaToToolArgument({ type: "integer", description: "an age" })).toEqual({
            type: "integer",
            description: "an age",
        });

        expect(convertOpenAPISchemaToToolArgument({ type: "number", description: "a price" })).toEqual({
            type: "number",
            description: "a price",
        });

        expect(convertOpenAPISchemaToToolArgument({ type: "boolean", description: "active status" })).toEqual({
            type: "boolean",
            description: "active status",
        });

        expect(convertOpenAPISchemaToToolArgument({ type: "string", enum: ["cat", "dog"], description: "pet type" })).toEqual({
            type: "string",
            description: "pet type",
            enum: ["cat", "dog"],
        });
    });

    it("converts array and object schemas recursively", () => {
        const objectSchema = {
            type: "object",
            description: "User details",
            properties: {
                name: { type: "string", description: "User name" },
                age: { type: "integer", description: "User age" },
                tags: {
                    type: "array",
                    description: "User tags",
                    items: { type: "string", description: "Tag name" },
                },
            },
            required: ["name"],
        };

        const result = convertOpenAPISchemaToToolArgument(objectSchema);
        expect(result).toEqual({
            type: "object",
            description: "User details",
            properties: {
                name: { type: "string", description: "User name", enum: undefined },
                age: { type: "integer", description: "User age" },
                tags: {
                    type: "array",
                    description: "User tags",
                    items: { type: "string", description: "Tag name", enum: undefined },
                },
            },
            required: ["name"],
            additionalProperties: undefined,
        });
    });
});

describe("buildToolsFromSpec", () => {
    const sampleConfig: OpenAPIToolProviderConfig = {
        name: "test-provider",
        type: "openapi",
        specUrl: "http://localhost:8080/openapi.json",
        securityVariables: {
            type: "apiKey",
            key: "secret-key",
            name: "X-Test-Key",
            location: "header",
        },
    };

    const doc = {
        openapi: "3.1.0",
        info: { title: "Test API", version: "1.0" },
        servers: [{ url: "http://localhost:8080/v1" }],
        paths: {
            "/pets": {
                get: {
                    operationId: "listPets",
                    summary: "List all pets",
                    parameters: [
                        { name: "limit", in: "query", schema: { type: "integer" }, required: false },
                    ],
                },
                post: {
                    summary: "Create a pet",
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
                },
            },
            "/pets/{petId}": {
                get: {
                    summary: "Get pet by ID",
                    parameters: [
                        { name: "petId", in: "path", required: true, schema: { type: "string" } },
                    ],
                },
            },
        },
    };

    it("extracts tools with correct names and schemas", () => {
        const tools = buildToolsFromSpec(doc, sampleConfig);
        expect(tools).toHaveLength(3);

        const toolNames = tools.map(t => t.name);
        expect(toolNames).toContain("listPets");
        expect(toolNames).toContain("post_pets");
        expect(toolNames).toContain("get_pets_petId");
    });

    it("correctly structures input schema for query and path parameters", () => {
        const tools = buildToolsFromSpec(doc, sampleConfig);

        const listPetsTool = tools.find(t => t.name === "listPets")!;
        expect(listPetsTool.description).toBe("List all pets");
        expect(listPetsTool.inputSchema.properties).toHaveProperty("limit");

        const getPetTool = tools.find(t => t.name === "get_pets_petId")!;
        expect(getPetTool.inputSchema.properties).toHaveProperty("petId");
        expect(getPetTool.inputSchema.required).toEqual(["petId"]);
    });
});

describe("registerOpenAPIToolProviders", () => {
    it("registers OpenAPI providers in toolProviderRegistry", () => {
        const initialCount = toolProviderRegistry.getAllToolProviders().length;

        registerOpenAPIToolProviders([
            {
                name: "my-openapi-service",
                type: "openapi",
                specUrl: "http://example.com/spec.json",
                securityVariables: { type: "bearerToken", token: "abc" },
            },
        ]);

        const providers = toolProviderRegistry.getAllToolProviders();
        expect(providers.length).toBe(initialCount + 1);

        const registered = providers[providers.length - 1] as OpenAPIToolProvider;
        expect(registered.config.name).toBe("my-openapi-service");
    });
});