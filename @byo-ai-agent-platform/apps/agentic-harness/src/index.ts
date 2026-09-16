import { Hono } from "hono";
import { bootstrap } from "./bootstrap";
import { HTTPException } from "hono/http-exception";

const { manager } = await bootstrap();

const app = new Hono()

app.get("/health", (c) => c.json({ healthy: "OK" }))

// create agent route
app.post("/interactions", async (c) => {
    const agent = await manager.createAgent()

    return c.json({
        id: agent.id
    })
})

// get all agent interactions 
app.get("/interactions", async (c) => {
    const agentIds = await manager.getAllAgents()

    return c.json(agentIds.map(id => {
        return { id }
    }))
})

// get interaction memory
app.get("/interactions/:id", async (c) => {
    const { id } = c.req.param()
    const interaction = await manager.getAgentInteraction(id)

    if (!interaction) {
        throw new HTTPException(404, { message: `Agent interaction ${id} does not exist.` })
    }
    return c.json(interaction)
})

export default app