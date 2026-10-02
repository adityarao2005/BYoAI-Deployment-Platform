import { z } from "zod";

/**
 * Extracts or generates a standard JSON Schema dictionary from a Zod schema or raw schema object.
 * Strips metadata fields like `$schema` and `~standard` so they are fully compatible with
 * OpenAI, Anthropic, Gemini, and Ollama tool parameter schemas.
 */
export function getToolJsonSchema(schema: unknown): Record<string, any> {
    if (!schema) {
        return { type: "object", properties: {} };
    }

    // If an explicit raw JSON schema is attached (e.g. from an MCP tool or OpenAPI tool)
    if (typeof schema === "object" && schema !== null && "rawJsonSchema" in schema) {
        return (schema as any).rawJsonSchema;
    }

    // If it's a Zod schema
    if (
        typeof schema === "object" &&
        schema !== null &&
        "safeParse" in schema &&
        typeof (schema as any).safeParse === "function"
    ) {
        const raw = z.toJSONSchema(schema as z.ZodTypeAny) as Record<string, any>;
        const { $schema, "~standard": _, ...rest } = raw;
        return rest;
    }

    // If it's already a plain JSON Schema object
    if (
        typeof schema === "object" &&
        schema !== null &&
        ("type" in schema || "properties" in schema)
    ) {
        return schema as Record<string, any>;
    }

    return { type: "object", properties: {} };
}

export type JsonSchemaZodTool = z.ZodType & {
    rawJsonSchema: Record<string, any>;
    properties: Record<string, any>;
    required: string[] | null;
};

/**
 * Creates a passthrough Zod schema that wraps an arbitrary raw JSON Schema
 * (such as those returned dynamically by MCP servers or OpenAPI specs).
 */
export function createJsonSchemaZodSchema(
    rawJsonSchema: Record<string, any>,
): JsonSchemaZodTool {
    const schema = z.record(z.string(), z.any()) as any;
    schema.rawJsonSchema = rawJsonSchema;
    schema.properties = rawJsonSchema.properties ?? {};
    schema.required = rawJsonSchema.required ?? null;
    return schema;
}
