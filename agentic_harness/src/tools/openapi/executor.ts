import { OpenAPIToolProviderConfig } from "@/config/tool_config";

export interface ExecuteOperationOptions {
    method: string;
    pathKey: string;
    baseUrl: string;
    allParams: any[];
    bodySchemaObj: any;
    config: OpenAPIToolProviderConfig;
    args: Record<string, any>;
}

export async function executeOpenAPIOperation({
    method,
    pathKey,
    baseUrl,
    allParams,
    bodySchemaObj,
    config,
    args,
}: ExecuteOperationOptions): Promise<any> {
    // 1. Path parameter replacement
    let resolvedPath = pathKey;
    for (const param of allParams.filter(p => p.in === "path")) {
        const nameKey = param.name as string;
        const val = args[nameKey] ?? (typeof args.body === "object" ? args.body?.[nameKey] : undefined) ?? (typeof args.requestBody === "object" ? args.requestBody?.[nameKey] : undefined);
        if (val !== undefined) {
            resolvedPath = resolvedPath.replace(`{${nameKey}}`, encodeURIComponent(String(val)));
        } else if (param.required) {
            throw new Error(`Missing required path parameter: ${nameKey}`);
        }
    }

    // 2. Resolve target URL
    let fullUrl: URL;
    if (baseUrl) {
        const baseWithSlash = baseUrl.endsWith("/") ? baseUrl : baseUrl + "/";
        const cleanPath = resolvedPath.startsWith("/") ? resolvedPath.slice(1) : resolvedPath;
        fullUrl = new URL(cleanPath, baseWithSlash);
    } else {
        fullUrl = new URL(resolvedPath);
    }

    // 3. Query parameters
    for (const param of allParams.filter(p => p.in === "query")) {
        const nameKey = param.name as string;
        const val = args[nameKey];
        if (val !== undefined) {
            fullUrl.searchParams.append(nameKey, String(val));
        }
    }

    // 4. Headers
    const headers: Record<string, string> = {};
    for (const param of allParams.filter(p => p.in === "header")) {
        const nameKey = param.name as string;
        const val = args[nameKey];
        if (val !== undefined) {
            headers[nameKey] = String(val);
        }
    }

    // 5. Security variables resolution
    const sec = config.securityVariables;
    if (sec) {
        if (sec.type === "apiKey") {
            const headerOrQueryName = sec.name || "X-API-Key";
            const loc = sec.location || "header";
            if (loc === "header") {
                headers[headerOrQueryName] = sec.key;
            } else if (loc === "query") {
                fullUrl.searchParams.append(headerOrQueryName, sec.key);
            } else if (loc === "cookie") {
                headers["Cookie"] = `${headerOrQueryName}=${sec.key}`;
            }
        } else if (sec.type === "bearerToken") {
            headers["Authorization"] = `Bearer ${sec.token}`;
        } else if (sec.type === "basicAuth") {
            const loc = sec.location || "header";
            if (loc === "header") {
                const credentials = Buffer.from(`${sec.username}:${sec.password}`).toString("base64");
                headers["Authorization"] = `Basic ${credentials}`;
            } else if (loc === "authority") {
                fullUrl.username = sec.username;
                fullUrl.password = sec.password;
            }
        } else if (sec.type === "custom") {
            if (sec.headers) {
                Object.assign(headers, sec.headers);
            }
            if (sec.queryParams) {
                for (const [qKey, qVal] of Object.entries(sec.queryParams)) {
                    fullUrl.searchParams.append(qKey, qVal);
                }
            }
            if (sec.urlAuthority) {
                if (sec.urlAuthority.user) fullUrl.username = sec.urlAuthority.user;
                if (sec.urlAuthority.password) fullUrl.password = sec.urlAuthority.password;
            }
        }
    }

    // 6. Request body determination
    let bodyPayload: any = undefined;
    if (args.requestBody !== undefined) {
        bodyPayload = args.requestBody;
    } else if (args.body !== undefined) {
        bodyPayload = args.body;
    } else if (bodySchemaObj && bodySchemaObj.type === "object" && bodySchemaObj.properties) {
        const inferredBody: Record<string, any> = {};
        let hasInferred = false;
        for (const propKey of Object.keys(bodySchemaObj.properties)) {
            if (args[propKey] !== undefined) {
                inferredBody[propKey] = args[propKey];
                hasInferred = true;
            }
        }
        if (hasInferred) {
            bodyPayload = inferredBody;
        }
    }

    if (bodyPayload !== undefined && !headers["Content-Type"] && !headers["content-type"]) {
        headers["Content-Type"] = "application/json";
    }

    const fetchOptions: RequestInit = {
        method: method.toUpperCase(),
        headers,
    };
    if (bodyPayload !== undefined) {
        fetchOptions.body = typeof bodyPayload === "string" ? bodyPayload : JSON.stringify(bodyPayload);
    }

    // 7. Perform HTTP request
    const response = await fetch(fullUrl.toString(), fetchOptions);
    const contentType = response.headers.get("content-type") || "";

    let data: any;
    if (contentType.includes("application/json") || contentType.includes("+json")) {
        data = await response.json();
    } else {
        data = await response.text();
    }

    if (!response.ok) {
        const errorDetail = typeof data === "string" ? data : JSON.stringify(data);
        throw new Error(`HTTP ${response.status} ${response.statusText}: ${errorDetail}`);
    }

    return data;
}
