
export type ToolArrayArgument = {
    type: "array",
    description: string,
    items: ToolArgument
}

export function toolArray(items: ToolArgument, description: string): ToolArrayArgument {
    return {
        type: "array",
        description,
        items
    };
}

export function isToolArrayArgument(arg: ToolArgument): arg is ToolArrayArgument {
    return arg.type === "array";
}

export type ToolIntegerArgument = {
    type: "integer",
    description: string
}

export function isToolIntegerArgument(arg: ToolArgument): arg is ToolIntegerArgument {
    return arg.type === "integer";
}

export function toolInteger(description: string): ToolIntegerArgument {
    return {
        type: "integer",
        description
    };
}

export type ToolNumberArgument = {
    type: "number",
    description: string
}

export function toolNumber(description: string): ToolNumberArgument {
    return {
        type: "number",
        description
    };
}

export function isToolNumberArgument(arg: ToolArgument): arg is ToolNumberArgument {
    return arg.type === "number";
}

export type ToolStringArgument = {
    type: "string",
    description: string
    enum?: string[] | undefined;
}

export function toolString(description: string, enumValues?: string[]): ToolStringArgument {
    return {
        type: "string",
        description,
        enum: enumValues
    };
}

export function isToolStringArgument(arg: ToolArgument): arg is ToolStringArgument {
    return arg.type === "string";
}

export type ToolBooleanArgument = {
    type: "boolean",
    description: string
}

export function toolBoolean(description: string): ToolBooleanArgument {
    return {
        type: "boolean",
        description
    };
}

export function isToolBooleanArgument(arg: ToolArgument): arg is ToolBooleanArgument {
    return arg.type === "boolean";
}

export type ToolObjectArgument = {
    type: "object",
    description: string,
    properties: Record<string, ToolArgument>,
    required?: string[] | null,
    additionalProperties?: boolean | undefined;
}

export function isToolObjectArgument(arg: ToolArgument): arg is ToolObjectArgument {
    return arg.type === "object";
}

export function toolObject(description: string, properties: Record<string, ToolArgument>, required?: string[], additionalProperties?: boolean): ToolObjectArgument {
    return {
        type: "object",
        description,
        properties,
        required: required || null,
        additionalProperties
    };
}

export function validateToolArgument(arg: ToolArgument, value: any): boolean {
    switch (arg.type) {
        case "string":
            if (typeof value !== "string") return false;
            if (arg.enum && !arg.enum.includes(value)) return false;
            return true;
        case "integer":
            return Number.isInteger(value);
        case "number":
            return typeof value === "number" && !Number.isNaN(value) && Number.isFinite(value);
        case "boolean":
            return typeof value === "boolean";
        case "array":
            if (!Array.isArray(value)) return false;
            return value.every(item => validateToolArgument(arg.items, item));
        case "object":
            if (typeof value !== "object" || value === null || Array.isArray(value)) return false;

            // Check required fields safely
            if (arg.required) {
                for (const req of arg.required) {
                    if (!Object.prototype.hasOwnProperty.call(value, req)) return false;
                }
            }

            // Validate properties that exist in the layout definition
            for (const key of Object.keys(arg.properties)) {
                if (Object.prototype.hasOwnProperty.call(value, key)) {
                    if (!validateToolArgument(arg.properties[key]!, value[key])) {
                        return false;
                    }
                }
            }

            // Restrict unknown properties safely
            if (arg.additionalProperties === false) {
                for (const key of Object.keys(value)) {
                    if (!(key in arg.properties)) return false;
                }
            }

            return true;
        default:
            return false;
    }
}

export type ToolArgument = ToolArrayArgument | ToolObjectArgument | ToolIntegerArgument | ToolStringArgument | ToolBooleanArgument | ToolNumberArgument | { type: string[]; description: string };
