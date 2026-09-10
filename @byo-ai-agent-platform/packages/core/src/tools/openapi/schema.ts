import { ToolArgument, toolArray, toolBoolean, toolInteger, toolNumber, toolObject, toolString } from "../tool_argument";

export function convertOpenAPISchemaToToolArgument(schema: any, fallbackDescription: string = ""): ToolArgument {
    if (!schema || typeof schema !== "object") {
        return toolString(fallbackDescription);
    }

    const description = schema.description || fallbackDescription;
    const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;

    switch (type) {
        case "integer":
            return toolInteger(description);
        case "number":
            return toolNumber(description);
        case "boolean":
            return toolBoolean(description);
        case "array":
            return toolArray(
                convertOpenAPISchemaToToolArgument(schema.items || {}, "Array item"),
                description
            );
        case "object": {
            const properties: Record<string, ToolArgument> = {};
            if (schema.properties && typeof schema.properties === "object") {
                for (const [key, propSchema] of Object.entries(schema.properties)) {
                    properties[key] = convertOpenAPISchemaToToolArgument(propSchema, key);
                }
            }
            const required = Array.isArray(schema.required) ? schema.required : undefined;
            return toolObject(description, properties, required);
        }
        case "string":
        default:
            return toolString(description, Array.isArray(schema.enum) ? schema.enum : undefined);
    }
}
