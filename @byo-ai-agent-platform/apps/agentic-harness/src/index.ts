import { Hono } from "hono";
import { bootstrap } from "./bootstrap";
import z from "zod";

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


export default app