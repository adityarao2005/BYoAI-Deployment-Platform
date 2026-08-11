import { OpenAPIToolProviderConfig } from "@/config/tool_config";
import { ToolObjectArgument, toolObject } from "../tool_argument";
import { Tool } from "../tools";
import { convertOpenAPISchemaToToolArgument } from "./schema";
import { executeOpenAPIOperation } from "./executor";

const HTTP_METHODS = ["get", "post", "put", "delete", "patch", "head", "options", "trace"];

export function buildToolsFromSpec(doc: Record<string, any>, config: OpenAPIToolProviderConfig): Tool[] {
    const tools: Tool[] = [];
    const paths = doc.paths || {};

    let baseUrl = "";
    if (Array.isArray(doc.servers) && doc.servers.length > 0 && doc.servers[0]?.url) {
        const serverUrl = doc.servers[0].url;
        if (serverUrl.startsWith("http://") || serverUrl.startsWith("https://")) {
            baseUrl = serverUrl;
        } else if (config.specUrl) {
            try {
                baseUrl = new URL(serverUrl, config.specUrl).toString();
            } catch {
                baseUrl = serverUrl;
            }
        }
    }

    if (!baseUrl && config.specUrl) {
        try {
            baseUrl = new URL(config.specUrl).origin;
        } catch {
            baseUrl = "";
        }
    }

    for (const [pathKey, pathItemObj] of Object.entries(paths)) {
        if (!pathItemObj || typeof pathItemObj !== "object") continue;

        const pathItem = pathItemObj as Record<string, any>;
        const pathLevelParams: any[] = Array.isArray(pathItem.parameters) ? pathItem.parameters : [];

        for (const method of HTTP_METHODS) {
            const operation = pathItem[method];
            if (!operation || typeof operation !== "object") continue;

            let toolName = "";
            if (operation.operationId && typeof operation.operationId === "string") {
                toolName = operation.operationId.replace(/[^a-zA-Z0-9_-]/g, "_");
            } else {
                const raw = `${method}_${pathKey}`;
                toolName = raw.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/^_+|_+$/g, "").replace(/__+/g, "_");
            }

            const description = operation.description || operation.summary || `${method.toUpperCase()} ${pathKey}`;

            // Gather parameters
            const opLevelParams: any[] = Array.isArray(operation.parameters) ? operation.parameters : [];
            const paramMap = new Map<string, any>();

            for (const p of [...pathLevelParams, ...opLevelParams]) {
                if (p && p.name && p.in) {
                    const key = `${p.in}:${p.name}`;
                    paramMap.set(key, p);
                }
            }

            const allParams = Array.from(paramMap.values());
            const properties: Record<string, any> = {};
            const requiredFields: string[] = [];

            for (const param of allParams) {
                const paramSchema = param.schema || { type: "string" };
                properties[param.name] = convertOpenAPISchemaToToolArgument(paramSchema, param.description || param.name);
                if (param.required) {
                    requiredFields.push(param.name);
                }
            }

            // Handle request body
            let bodySchemaObj: any = null;
            if (operation.requestBody && typeof operation.requestBody === "object") {
                const content = operation.requestBody.content || {};
                const firstKey = Object.keys(content)[0];
                const jsonContent = content["application/json"] || (firstKey ? content[firstKey] : undefined);
                if (jsonContent?.schema) {
                    bodySchemaObj = jsonContent.schema;
                    const bodyArg = convertOpenAPISchemaToToolArgument(bodySchemaObj, operation.requestBody.description || "Request body");
                    if (!properties["requestBody"]) {
                        properties["requestBody"] = bodyArg;
                    }
                    if (!properties["body"]) {
                        properties["body"] = bodyArg;
                    }

                    // Inline top-level properties if object schema
                    if (bodySchemaObj.type === "object" && bodySchemaObj.properties) {
                        for (const [propKey, propSchema] of Object.entries(bodySchemaObj.properties)) {
                            if (!properties[propKey]) {
                                properties[propKey] = convertOpenAPISchemaToToolArgument(propSchema, propKey);
                            }
                        }
                    }

                    if (operation.requestBody.required) {
                        if (!requiredFields.includes("requestBody") && !requiredFields.includes("body")) {
                            requiredFields.push("requestBody");
                        }
                    }
                }
            }

            const inputSchema: ToolObjectArgument = toolObject(
                `Input parameters for ${toolName}`,
                properties,
                requiredFields.length > 0 ? requiredFields : undefined
            );

            const tool: Tool = {
                name: toolName,
                description,
                inputSchema,
                async execute(args: Record<string, any> = {}) {
                    return executeOpenAPIOperation({
                        method,
                        pathKey,
                        baseUrl,
                        allParams,
                        bodySchemaObj,
                        config,
                        args,
                    });
                },
            };

            tools.push(tool);
        }
    }

    return tools;
}
