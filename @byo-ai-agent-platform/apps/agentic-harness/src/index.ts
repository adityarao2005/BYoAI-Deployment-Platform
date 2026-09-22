import type { AgentEventMap } from "@byo-ai-agent-platform/core/agents";
import { zValidator as zv } from "@hono/zod-validator";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { streamSSE } from "hono/streaming";
import z from "zod";
import { bootstrap } from "./bootstrap";
import { jwk } from "hono/jwk";

const { manager, config } = await bootstrap();

const app = new Hono()
    .get("/health", (c) => c.json({ healthy: "OK" }))
    .use("/*", jwk({
        jwks_uri: (c) => config.security.jwksUri,
        alg: config.security.alg,
        verification: config.security.verify
    }));


// create agent route
app.post("/interactions", async (c) => {
    const agent = await manager.createAgent();

    return c.json({
        id: agent.id,
    });
});

// get all agent interactions
app.get("/interactions", async (c) => {
    const agentIds = await manager.getAllAgents();

    return c.json(
        agentIds.map((id) => {
            return { id };
        }),
    );
});

// get interaction memory
app.get("/interactions/:id", async (c) => {
    const { id } = c.req.param();
    const interaction = await manager.getAgentInteraction(id);

    if (!interaction) {
        throw new HTTPException(404, {
            message: `Agent interaction ${id} does not exist.`,
        });
    }
    return c.json(interaction);
});

// post a message to the agent
app.post(
    "/interactions/:id",
    zv(
        "json",
        z.object({
            message: z.string(),
        }),
    ),
    async (c) => {
        // get the id
        const { id } = c.req.param();
        const interaction = await manager.getAgentInteraction(id);

        if (!interaction) {
            throw new HTTPException(404, {
                message: `Agent interaction ${id} does not exist.`,
            });
        }

        // send message to agent
        const body = await c.req.valid("json");
        await manager.sendMessageToAgent(id, body.message);
    },
);

// design for SSE
// we create a map of readable streams (by id)
// then we first drain all the events then we pipe the
// then we pipe any event onto the SSE stream
// we'd leverage the AgentCommunicator subscription interfaces (since we're not directly interacting with the Agent and agent observer is for observability and not messaging)

app.get("/interactions/:id/sse", async (c) => {
    const { id } = c.req.param();
    const interaction = await manager.getAgentInteraction(id);

    if (!interaction) {
        throw new HTTPException(404, {
            message: `Agent interaction ${id} does not exist.`,
        });
    }

    return streamSSE(c, async (stream) => {
        const queue: Array<{ event: string; data: string }> = [];
        let wakeUp: (() => void) | null = null;

        const pushEvent = (event: string, payload: any) => {
            queue.push({
                event,
                data: JSON.stringify(payload),
            });
            if (wakeUp) {
                wakeUp();
                wakeUp = null;
            }
        };

        // Drain chat transcript history into SSE stream
        for (const entry of interaction.transcript) {
            if (entry.type === "message") {
                if (entry.role === "user") {
                    pushEvent("user:message", {
                        agentId: id,
                        content: entry.content,
                    });
                } else if (entry.role === "assistant") {
                    pushEvent("agent:message", {
                        agentId: id,
                        content: entry.content,
                    });
                }
            } else if (entry.type === "tool_call") {
                pushEvent("tool:call", {
                    agentId: id,
                    toolCallId: entry.id,
                    tool: entry.tool.name,
                    args: entry.arguments,
                });
            } else if (entry.type === "tool_response") {
                pushEvent("tool:complete", {
                    agentId: id,
                    toolCallId: entry.id,
                    tool: entry.tool.name,
                    result: entry.result,
                });
            }
        }

        const eventNames: Array<keyof AgentEventMap> = [
            "user:message",
            "agent:message",
            "agent:run",
            "agent:complete",
            "tool:call",
            "tool:complete",
        ];

        const unsubscribers = eventNames.map((eventName) =>
            manager.communicator.on(eventName, (payload) => {
                if (payload.agentId === id) {
                    pushEvent(eventName, payload);
                }
            }),
        );

        stream.onAbort(() => {
            for (const unsub of unsubscribers) {
                unsub();
            }
        });

        try {
            while (!stream.aborted) {
                if (queue.length === 0) {
                    await new Promise<void>((resolve) => {
                        wakeUp = resolve;
                        stream.onAbort(() => resolve());
                    });
                }

                while (queue.length > 0 && !stream.aborted) {
                    const item = queue.shift();
                    if (item) {
                        await stream.writeSSE({
                            event: item.event,
                            data: item.data,
                        });
                    }
                }
            }
        } finally {
            for (const unsub of unsubscribers) {
                unsub();
            }
        }
    });
});

export default app;
