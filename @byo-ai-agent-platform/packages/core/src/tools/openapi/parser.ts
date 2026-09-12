import RefParser from "@apidevtools/json-schema-ref-parser";
import { upgrade } from "@scalar/openapi-upgrader";
import { parse } from "yaml";

export async function normalizeOpenAPIDocument(rawParsed: unknown): Promise<object> {
    if (!rawParsed || typeof rawParsed !== "object") {
        throw new Error("Invalid spec format: Response did not resolve to a valid JSON/YAML object.");
    }

    // openapi document upgrade to 3.1
    const document = upgrade(rawParsed as any, "3.1");

    // Resolve/Inline all $ref pointers using RefParser
    return RefParser.dereference(document);
}

export async function parseSpecURL(specURL: string): Promise<object> {
    const response = await fetch(specURL, {
        method: "GET",
        headers: {
            Accept: "application/json, application/x-yaml, text/yaml, text/plain, */*",
        },
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch OpenAPI spec from ${specURL}: HTTP ${response.status} ${response.statusText}`);
    }

    const text = await response.text();
    let rawParsed: unknown;
    try {
        rawParsed = parse(text);
    } catch (err) {
        throw new Error(`Failed to parse response body as valid JSON or YAML: ${err}`);
    }

    return normalizeOpenAPIDocument(rawParsed);
}
