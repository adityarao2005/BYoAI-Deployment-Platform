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