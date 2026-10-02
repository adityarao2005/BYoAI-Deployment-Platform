import type { Agent2AgentToolProviderConfig } from "@/config";
import { toolObject, toolString } from "../tool_argument";
import type { Tool, ToolProvider } from "../tools";

export class Agent2AgentToolProvider implements ToolProvider {
    agentBaseUrl: string;
    name: string;
    description?: string;
    timeoutMs: number;

    constructor(config: Agent2AgentToolProviderConfig) {
        this.agentBaseUrl = config.url.replace(/\/+$/, "");
        this.name = config.name;
        this.description = config.description;
        this.timeoutMs = config.timeoutMs ?? 120_000;
    }

    async getToolByName(name: string): Promise<Tool | null> {
        return (await this.getAllTools()).find((tool) => tool.name === name) ?? null;
    }

    async getAllTools(): Promise<Tool[]> {
        const baseUrl = this.agentBaseUrl;
        const agentName = this.name;
        const sanitizedName = agentName.toLowerCase().replace(/[^a-zA-Z0-9_]/g, "_");
        const toolName = `agent_${sanitizedName}_exec_task`;
        const description =
            this.description ??
            `Calls external agent ${agentName} for help to perform a task`;
        const timeoutMs = this.timeoutMs;

        return [
            {
                name: toolName,
                description,
                inputSchema: toolObject(
                    "Input parameters for delegating a task to the agent",
                    {
                        prompt: toolString("Prompt of task to be performed by the agent"),
                    },
                    ["prompt"],
                ),
                async execute(args, session) {
                    const prompt = args?.prompt;
                    if (!prompt || typeof prompt !== "string") {
                        throw new Error(
                            "Missing or invalid 'prompt' argument: expected a non-empty string.",
                        );
                    }

                    // Grab access token from session if present
                    const accessToken = session?.authContext?.accessToken;
                    const jsonHeaders: Record<string, string> = {
                        "Content-Type": "application/json",
                    };
                    if (accessToken) {
                        jsonHeaders.Authorization = `Bearer ${accessToken}`;
                    }

                    // 1. Create a non-interactive interaction session
                    const createResponse = await fetch(`${baseUrl}/interactions`, {
                        method: "POST",
                        headers: jsonHeaders,
                        body: JSON.stringify({
                            mode: "non-interactive",
                        }),
                    });

                    if (!createResponse.ok) {
                        const errorText = await createResponse.text().catch(() => "");
                        throw new Error(
                            `Failed to create agent session on ${baseUrl}: HTTP ${createResponse.status} ${createResponse.statusText} - ${errorText}`,
                        );
                    }

                    const { id } = (await createResponse.json()) as { id: string | number };
                    const interactionId = String(id);

                    // 2. Listen onto the agent feed with EventSource
                    // 2. Listen onto the agent feed with EventSource
                    return new Promise((resolve, reject) => {
                        const eventSourceInit: any = {};
                        if (accessToken) {
                            eventSourceInit.headers = {
                                Authorization: `Bearer ${accessToken}`,
                            };
                        }

                        const EventSourceConstructor = (globalThis as any).EventSource ?? EventSource;
                        const eventSource = new EventSourceConstructor(
                            `${baseUrl}/interactions/${interactionId}/sse`,
                            eventSourceInit,
                        );

                        const agentMessages: string[] = [];
                        let isDone = false;

                        const cleanup = () => {
                            if (isDone) return;
                            isDone = true;
                            clearTimeout(timeoutId);
                            eventSource.close();
                        };

                        const timeoutId = setTimeout(() => {
                            cleanup();
                            reject(
                                new Error(
                                    `Timeout: agent '${agentName}' did not complete within ${timeoutMs}ms.`,
                                ),
                            );
                        }, timeoutMs);

                        eventSource.addEventListener("agent:message", (event: any) => {
                            try {
                                const payload = JSON.parse(event?.data ?? "{}");
                                if (typeof payload?.content === "string") {
                                    agentMessages.push(payload.content);
                                }
                            } catch {
                                if (event?.data) {
                                    agentMessages.push(String(event.data));
                                }
                            }
                        });

                        eventSource.addEventListener("agent:complete", () => {
                            cleanup();
                            resolve({
                                result:
                                    agentMessages.length > 0
                                        ? agentMessages.join("\n\n")
                                        : "Agent completed task successfully.",
                                interactionId,
                            });
                        });

                        eventSource.addEventListener("agent:error", (event: any) => {
                            cleanup();
                            let errorMsg = event?.data;
                            try {
                                const payload = JSON.parse(errorMsg ?? "{}");
                                errorMsg = payload?.error ?? errorMsg;
                            } catch { }
                            reject(new Error(`Agent '${agentName}' failed: ${errorMsg}`));
                        });

                        eventSource.onerror = () => {
                            if (isDone) return;
                            cleanup();
                            reject(
                                new Error(
                                    `EventSource connection error for agent '${agentName}'.`,
                                ),
                            );
                        };

                        // 3. Send message to the agent
                        fetch(`${baseUrl}/interactions/${interactionId}`, {
                            method: "POST",
                            headers: jsonHeaders,
                            body: JSON.stringify({
                                message: prompt,
                            }),
                        })
                            .then(async (messageResponse) => {
                                if (!messageResponse.ok) {
                                    const errorText = await messageResponse
                                        .text()
                                        .catch(() => "");
                                    cleanup();
                                    reject(
                                        new Error(
                                            `Failed to post message to agent ${interactionId}: HTTP ${messageResponse.status} - ${errorText}`,
                                        ),
                                    );
                                }
                            })
                            .catch((fetchError) => {
                                cleanup();
                                reject(fetchError);
                            });
                    });
                },
            },
        ];
    }
}