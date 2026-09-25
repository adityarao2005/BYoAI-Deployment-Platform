import type { AgentEventMap } from "@byo-ai-agent-platform/core/agents";
import { zValidator as zv } from "@hono/zod-validator";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { streamSSE } from "hono/streaming";
import z from "zod";
import { bootstrap } from "./bootstrap";
import { jwk } from "hono/jwk";
import type { JwtVariables } from "hono/jwt";
import { logger } from "hono/logger";
import { getLogger } from "@byo-ai-agent-platform/core/logger";

const { manager, config } = await bootstrap();

const appLogger = getLogger("AppLogger")

const app = new Hono<{ Variables: JwtVariables }>()

app.get("/health", (c) => c.json({ healthy: "OK" }))

app.use(jwk({
    jwks_uri: (c) => config.security.jwksUri,
    alg: config.security.alg,
    verification: config.security.verify
}));

app.use(logger((message, ...rest) => appLogger.info(message, ...rest)))

app.use(async (c, next) => {
    const payload = c.get("jwtPayload");
    const sub = payload?.sub;

    if (sub) {
        const authHeader = c.req.header("authorization");
        const rawToken = authHeader?.startsWith("Bearer ")
            ? authHeader.slice(7)
            : undefined;

        await manager.userTokenManager.setUserToken(sub, {
            accessToken: rawToken,
            idToken: typeof payload?.id_token === "string" ? payload.id_token : undefined,
            extraHeaders: {
                ...(authHeader ? { authorization: authHeader } : {}),
            },
        });
    }

    appLogger.debug("Authorized Access:", `Path ${c.req.path}`, `Subject: ${sub}`);

    await next();
});


// create agent route
app.post("/interactions", async (c) => {

    const sub = c.get("jwtPayload").sub
    const agent = await manager.createAgent(sub);

    return c.json({
        id: agent.id,
    });
});

// get all agent interactions
app.get("/interactions", async (c) => {
    const sub = c.get("jwtPayload").sub
    const agentIds = await manager.getAllAgentsByUser(sub);

    return c.json(
        agentIds.map((id) => {
            return { id };
        }),
    );
});

// get interaction memory
app.get("/interactions/:id", async (c) => {
    const { id } = c.req.param();
    const sub = c.get("jwtPayload").sub
    const interaction = await manager.getAgentInteractionByUser(id, sub);

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
        const sub = c.get("jwtPayload").sub
        const interaction = await manager.getAgentInteractionByUser(id, sub);

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
    const sub = c.get("jwtPayload").sub
    const interaction = await manager.getAgentInteractionByUser(id, sub);

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

// admin stuff
app.use("/admin/*", async (c, next) => {
    const jwtPayload = c.get("jwtPayload")

    // 1. Standard top-level claims (Auth0 / custom OIDC)
    const roles: string[] = Array.isArray(jwtPayload?.roles)
        ? jwtPayload.roles
        : typeof jwtPayload?.role === "string"
            ? [jwtPayload.role]
            : [];

    const providedRoles = new Set(roles)
    const requiredRolesSet = new Set(config.security.adminRoles ?? [])

    if (requiredRolesSet.intersection(providedRoles).size > 0) {
        return await next()
    }

    throw new HTTPException(403, {
        message: "Forbidden! You do not have valid roles to access this resource."
    })
})

// get interaction memory
app.get("/admin/interactions/:id", async (c) => {
    const { id } = c.req.param();
    const interaction = await manager.getAgentInteraction(id);

    if (!interaction) {
        throw new HTTPException(404, {
            message: `Agent interaction ${id} does not exist.`,
        });
    }
    return c.json(interaction);
});

// get all agent interactions
app.get("/admin/interactions", async (c) => {
    const agentIds = await manager.getAllAgents();

    return c.json(
        agentIds.map((id) => {
            return { id };
        }),
    );
});

export default app;
