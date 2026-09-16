import { describe, expect, it } from "bun:test";
import {
    modelRegistry,
    SelfHostedModel,
} from "@byo-ai-agent-platform/core/models";

// Ensure model registered before loading index.ts (bootstrap())
if (!modelRegistry.getDefaultModel()) {
    modelRegistry.registerModel(
        "test-model",
        new SelfHostedModel("http://localhost:8080/v1", "test-model"),
    );
}

const { default: app } = await import("./index");

describe("SSE interaction endpoint", () => {
    it("returns 404 for non-existent interaction ID", async () => {
        const res = await app.request("/interactions/non-existent-id/sse");
        expect(res.status).toBe(404);
    });

    it("creates an interaction and connects to sse stream", async () => {
        const createRes = await app.request("/interactions", {
            method: "POST",
        });
        expect(createRes.status).toBe(200);
        const { id } = (await createRes.json()) as { id: string };

        const sseRes = await app.request(`/interactions/${id}/sse`);
        expect(sseRes.status).toBe(200);
        expect(sseRes.headers.get("content-type")).toContain(
            "text/event-stream",
        );
    });
});
