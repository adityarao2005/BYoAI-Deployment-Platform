import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";

const server = new McpServer({
    name: "system_mcp",
    version: "1.0.0",
});

// In-memory key-value note storage
const notesStore = new Map<string, string>();

server.registerTool(
    "calculate",
    {
        description:
            "Performs mathematical calculations (add, subtract, multiply, divide, power).",
        inputSchema: {
            operation: z
                .enum(["add", "subtract", "multiply", "divide", "power"])
                .describe("Math operation"),
            a: z.number().describe("First number"),
            b: z.number().describe("Second number"),
        },
    },
    async ({ operation, a, b }) => {
        let result: number;
        switch (operation) {
            case "add":
                result = a + b;
                break;
            case "subtract":
                result = a - b;
                break;
            case "multiply":
                result = a * b;
                break;
            case "divide":
                if (b === 0) {
                    throw new Error("Division by zero is undefined.");
                }
                result = a / b;
                break;
            case "power":
                result = Math.pow(a, b);
                break;
        }

        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({ operation, a, b, result }),
                },
            ],
        };
    },
);

server.registerTool(
    "fetch_system_status",
    {
        description:
            "Returns server environment metrics including platform, node/bun runtime, and memory usage.",
        inputSchema: {},
    },
    async () => {
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(
                        {
                            status: "healthy",
                            platform: process.platform,
                            arch: process.arch,
                            runtime:
                                typeof Bun !== "undefined"
                                    ? `Bun v${Bun.version}`
                                    : `Node.js ${process.version}`,
                            uptimeSeconds: Math.round(process.uptime()),
                            memoryUsageMb: Math.round(
                                process.memoryUsage().heapUsed / 1024 / 1024,
                            ),
                            timestamp: new Date().toISOString(),
                        },
                        null,
                        2,
                    ),
                },
            ],
        };
    },
);

server.registerTool(
    "store_note",
    {
        description:
            "Stores a persistent key-value note into agent memory. (Requires user confirmation).",
        inputSchema: {
            key: z.string().describe("Unique identifier for the note"),
            content: z.string().describe("Text content of the note"),
        },
    },
    async ({ key, content }) => {
        notesStore.set(key, content);
        return {
            content: [
                {
                    type: "text",
                    text: `Successfully stored note '${key}'. Total notes: ${notesStore.size}`,
                },
            ],
        };
    },
);

server.registerResource(
    "system_manifest",
    "system://manifest.json",
    {
        description:
            "System manifest containing environment metadata and server capabilities",
        mimeType: "application/json",
    },
    async () => {
        return {
            contents: [
                {
                    uri: "system://manifest.json",
                    text: JSON.stringify(
                        {
                            name: "system_mcp",
                            version: "1.0.0",
                            transport: "stdio",
                            capabilities: [
                                "calculate",
                                "fetch_system_status",
                                "store_note",
                            ],
                            environment: "development",
                        },
                        null,
                        2,
                    ),
                },
            ],
        };
    },
);

// Connect via standard I/O transport
const transport = new StdioServerTransport();
await server.connect(transport);
