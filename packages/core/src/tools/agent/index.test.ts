import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { AgentSession } from "@/agents";
import { Agent2AgentToolProvider } from ".";

class MockEventSource {
    static instances: MockEventSource[] = [];

    url: string;
    init?: any;
    listeners: Map<string, Array<(event: any) => void>> = new Map();
    closed = false;
    onerror: ((err?: any) => void) | null = null;

    constructor(url: string, init?: any) {
        this.url = url;
        this.init = init;
        MockEventSource.instances.push(this);
    }

    addEventListener(event: string, handler: (event: any) => void) {
        const list = this.listeners.get(event) ?? [];
        list.push(handler);
        this.listeners.set(event, list);
    }

    emit(event: string, data: any) {
        const list = this.listeners.get(event) ?? [];
        for (const handler of list) {
            handler({ data: typeof data === "string" ? data : JSON.stringify(data) });
        }
    }

    close() {
        this.closed = true;
    }
}

describe("Agent2AgentToolProvider", () => {
    let originalFetch: typeof globalThis.fetch;
    let originalEventSource: any;

    beforeEach(() => {
        originalFetch = globalThis.fetch;
        originalEventSource = (globalThis as any).EventSource;
        MockEventSource.instances = [];
        (globalThis as any).EventSource = MockEventSource;
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        (globalThis as any).EventSource = originalEventSource;
    });

    const createDummySession = (accessToken?: string): AgentSession => {
        return {
            agent: { id: "caller-agent", name: "caller-agent", userId: "user-1" },
            name: "test-session",
            userId: "user-1",
            authContext: accessToken ? { accessToken } : undefined,
        } as unknown as AgentSession;
    };

    describe("metadata and tools registration", () => {
        it("sanitizes tool name and provides default description", async () => {
            const provider = new Agent2AgentToolProvider({
                type: "agent",
                name: "code-reviewer",
                url: "http://localhost:3000/",
            });

            const tools = await provider.getAllTools();
            expect(tools).toHaveLength(1);
            expect(tools[0]!.name).toBe("agent_code_reviewer_exec_task");
            expect(tools[0]!.description).toBe(
                "Calls external agent code-reviewer for help to perform a task",
            );
            expect(tools[0]!.inputSchema.required).toContain("prompt");

            const byName = await provider.getToolByName("agent_code_reviewer_exec_task");
            expect(byName).not.toBeNull();
            expect(byName?.name).toBe("agent_code_reviewer_exec_task");

            const notFound = await provider.getToolByName("unknown");
            expect(notFound).toBeNull();
        });

        it("uses custom description when provided", async () => {
            const provider = new Agent2AgentToolProvider({
                type: "agent",
                name: "analyst",
                url: "http://localhost:3000",
                description: "Performs financial analysis and metric summaries.",
            });

            const tool = await provider.getToolByName("agent_analyst_exec_task");
            expect(tool?.description).toBe(
                "Performs financial analysis and metric summaries.",
            );
        });
    });

    describe("execute", () => {
        it("throws error when prompt is missing or not a string", async () => {
            const provider = new Agent2AgentToolProvider({
                type: "agent",
                name: "helper",
                url: "http://localhost:3000",
            });
            const tool = (await provider.getToolByName("agent_helper_exec_task"))!;
            const session = createDummySession();

            await expect(tool.execute({}, session)).rejects.toThrow(
                "Missing or invalid 'prompt' argument",
            );
            await expect(tool.execute({ prompt: 123 }, session)).rejects.toThrow(
                "Missing or invalid 'prompt' argument",
            );
        });

        it("successfully creates interaction, subscribes to EventSource, sends message, and completes", async () => {
            const provider = new Agent2AgentToolProvider({
                type: "agent",
                name: "helper",
                url: "http://agent-service:4000/",
            });
            const tool = (await provider.getToolByName("agent_helper_exec_task"))!;
            const session = createDummySession("jwt-token-xyz");

            const requestedUrls: string[] = [];
            const postedBodies: any[] = [];
            const authHeaders: (string | null)[] = [];

            // Mock fetch calls
            globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
                const urlStr = url.toString();
                requestedUrls.push(urlStr);
                authHeaders.push(
                    (init?.headers as Record<string, string>)?.[
                        "Authorization"
                    ] ?? null,
                );

                if (urlStr === "http://agent-service:4000/interactions" && init?.method === "POST") {
                    postedBodies.push(JSON.parse(init.body as string));
                    return new Response(JSON.stringify({ id: "agent-session-42" }), {
                        status: 200,
                        headers: { "Content-Type": "application/json" },
                    });
                }

                if (
                    urlStr === "http://agent-service:4000/interactions/agent-session-42" &&
                    init?.method === "POST"
                ) {
                    postedBodies.push(JSON.parse(init.body as string));

                    // Once the message is posted, trigger events via the MockEventSource instance
                    setTimeout(() => {
                        const eventSourceInstance = MockEventSource.instances[0]!;
                        eventSourceInstance.emit("agent:message", {
                            agentId: "agent-session-42",
                            content: "Task analysis complete.",
                        });
                        eventSourceInstance.emit("agent:message", {
                            agentId: "agent-session-42",
                            content: "Final output result: 42.",
                        });
                        eventSourceInstance.emit("agent:complete", {
                            agentId: "agent-session-42",
                        });
                    }, 5);

                    return new Response(JSON.stringify({ success: true }), {
                        status: 200,
                        headers: { "Content-Type": "application/json" },
                    });
                }

                return new Response("Not Found", { status: 404 });
            }) as unknown as typeof fetch;

            const result = await tool.execute(
                { prompt: "Calculate answer" },
                session,
            );

            expect(result).toEqual({
                result: "Task analysis complete.\n\nFinal output result: 42.",
                interactionId: "agent-session-42",
            });

            // Verify non-interactive mode on create
            expect(postedBodies[0]).toEqual({ mode: "non-interactive" });
            // Verify message posted
            expect(postedBodies[1]).toEqual({ message: "Calculate answer" });
            // Verify auth header passed to fetch
            expect(authHeaders[0]).toBe("Bearer jwt-token-xyz");
            expect(authHeaders[1]).toBe("Bearer jwt-token-xyz");

            // Verify EventSource subscription
            expect(MockEventSource.instances).toHaveLength(1);
            const es = MockEventSource.instances[0]!;
            expect(es.url).toBe("http://agent-service:4000/interactions/agent-session-42/sse");
            expect(es.init?.headers?.Authorization).toBe("Bearer jwt-token-xyz");
            expect(es.closed).toBe(true);
        });

        it("fails if interaction creation returns an error status", async () => {
            const provider = new Agent2AgentToolProvider({
                type: "agent",
                name: "helper",
                url: "http://localhost:3000",
            });
            const tool = (await provider.getToolByName("agent_helper_exec_task"))!;
            const session = createDummySession();

            globalThis.fetch = (async () => {
                return new Response("Unauthorized", { status: 401 });
            }) as unknown as typeof fetch;

            await expect(
                tool.execute({ prompt: "Do something" }, session),
            ).rejects.toThrow("Failed to create agent session");
        });

        it("fails if posting message fails", async () => {
            const provider = new Agent2AgentToolProvider({
                type: "agent",
                name: "helper",
                url: "http://localhost:3000",
            });
            const tool = (await provider.getToolByName("agent_helper_exec_task"))!;
            const session = createDummySession();

            globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
                const urlStr = url.toString();
                if (urlStr.endsWith("/interactions") && init?.method === "POST") {
                    return new Response(JSON.stringify({ id: "fail-msg-1" }), {
                        status: 200,
                    });
                }
                if (urlStr.endsWith("/interactions/fail-msg-1") && init?.method === "POST") {
                    return new Response("Internal Server Error", { status: 500 });
                }
                return new Response("Not Found", { status: 404 });
            }) as unknown as typeof fetch;

            await expect(
                tool.execute({ prompt: "Do something" }, session),
            ).rejects.toThrow("Failed to post message to agent fail-msg-1: HTTP 500");
        });

        it("fails if agent emits agent:error event", async () => {
            const provider = new Agent2AgentToolProvider({
                type: "agent",
                name: "helper",
                url: "http://localhost:3000",
            });
            const tool = (await provider.getToolByName("agent_helper_exec_task"))!;
            const session = createDummySession();

            globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
                const urlStr = url.toString();
                if (urlStr.endsWith("/interactions") && init?.method === "POST") {
                    return new Response(JSON.stringify({ id: "err-agent-1" }), {
                        status: 200,
                    });
                }
                if (urlStr.endsWith("/interactions/err-agent-1") && init?.method === "POST") {
                    setTimeout(() => {
                        const es = MockEventSource.instances[0]!;
                        es.emit("agent:error", {
                            agentId: "err-agent-1",
                            error: "Model quota exceeded",
                        });
                    }, 5);
                    return new Response(JSON.stringify({ success: true }), {
                        status: 200,
                    });
                }
                return new Response("Not Found", { status: 404 });
            }) as unknown as typeof fetch;

            await expect(
                tool.execute({ prompt: "Run long task" }, session),
            ).rejects.toThrow("Agent 'helper' failed: Model quota exceeded");

            expect(MockEventSource.instances[0]!.closed).toBe(true);
        });

        it("fails if EventSource encounters connection error", async () => {
            const provider = new Agent2AgentToolProvider({
                type: "agent",
                name: "helper",
                url: "http://localhost:3000",
            });
            const tool = (await provider.getToolByName("agent_helper_exec_task"))!;
            const session = createDummySession();

            globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
                const urlStr = url.toString();
                if (urlStr.endsWith("/interactions") && init?.method === "POST") {
                    return new Response(JSON.stringify({ id: "conn-err-1" }), {
                        status: 200,
                    });
                }
                if (urlStr.endsWith("/interactions/conn-err-1") && init?.method === "POST") {
                    setTimeout(() => {
                        const es = MockEventSource.instances[0]!;
                        if (es.onerror) es.onerror(new Error("Network drop"));
                    }, 5);
                    return new Response(JSON.stringify({ success: true }), {
                        status: 200,
                    });
                }
                return new Response("Not Found", { status: 404 });
            }) as unknown as typeof fetch;

            await expect(
                tool.execute({ prompt: "Network test" }, session),
            ).rejects.toThrow("EventSource connection error for agent 'helper'.");

            expect(MockEventSource.instances[0]!.closed).toBe(true);
        });

        it("handles timeout if agent does not complete in time", async () => {
            const provider = new Agent2AgentToolProvider({
                type: "agent",
                name: "slow-agent",
                url: "http://localhost:3000",
                timeoutMs: 40,
            });
            const tool = (await provider.getToolByName("agent_slow_agent_exec_task"))!;
            const session = createDummySession();

            globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
                const urlStr = url.toString();
                if (urlStr.endsWith("/interactions") && init?.method === "POST") {
                    return new Response(JSON.stringify({ id: "slow-1" }), {
                        status: 200,
                    });
                }
                if (urlStr.endsWith("/interactions/slow-1") && init?.method === "POST") {
                    // Never emit complete
                    return new Response(JSON.stringify({ success: true }), {
                        status: 200,
                    });
                }
                return new Response("Not Found", { status: 404 });
            }) as unknown as typeof fetch;

            await expect(
                tool.execute({ prompt: "Slow task" }, session),
            ).rejects.toThrow("Timeout: agent 'slow-agent' did not complete within 40ms.");

            expect(MockEventSource.instances[0]!.closed).toBe(true);
        });
    });
});
