export function convertOpenAPISchemaToToolArgument(
    schema: any,
    fallbackDescription: string = "",
): any {
    if (!schema || typeof schema !== "object") {
        return {
            type: "string",
            description: fallbackDescription,
        };
    }

    const description = schema.description || fallbackDescription;
    const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;

    switch (type) {
        case "integer":
            return {
                type: "integer",
                description,
            };
        case "number":
            return {
                type: "number",
                description,
            };
        case "boolean":
            return {
                type: "boolean",
                description,
            };
        case "array":
            return {
                type: "array",
                description,
                items: convertOpenAPISchemaToToolArgument(
                    schema.items || {},
                    "Array item",
                ),
            };
        case "object": {
            const properties: Record<string, any> = {};
            if (schema.properties && typeof schema.properties === "object") {
                for (const [key, propSchema] of Object.entries(
                    schema.properties,
                )) {
                    properties[key] = convertOpenAPISchemaToToolArgument(
                        propSchema,
                        key,
                    );
                }
            }
            const required = Array.isArray(schema.required)
                ? schema.required
                : null;
            return {
                type: "object",
                description,
                properties,
                required,
                additionalProperties: undefined,
            };
        }
        default:
            return {
                type: "string",
                description,
                enum: Array.isArray(schema.enum) ? schema.enum : undefined,
            };
    }
}
