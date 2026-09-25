import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { modelRegistry, SelfHostedModel } from "@byo-ai-agent-platform/core/models";
import { skillRepositoryRegistry } from "@byo-ai-agent-platform/core/skills";
import { toolProviderRegistry } from "@byo-ai-agent-platform/core/tools";

let tempConfigPath: string;
let originalFetch: typeof globalThis.fetch;
let privateKey: crypto.KeyObject;
let publicKey: crypto.KeyObject;
let publicJwk: Record<string, any>;
let user1Token: string;
let user2Token: string;
let adminToken: string;
let app: any;

function base64url(input: string | Buffer): string {
    return Buffer.from(input)
        .toString("base64")
        .replace(/=/g, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");
}

function signJwt(payload: Record<string, any>, key: crypto.KeyObject): string {
    const header = { alg: "RS256", typ: "JWT", kid: "test-key-id" };
    const encodedHeader = base64url(JSON.stringify(header));
    const encodedPayload = base64url(JSON.stringify(payload));
    const dataToSign = `${encodedHeader}.${encodedPayload}`;

    const signer = crypto.createSign("RSA-SHA256");
    signer.update(dataToSign);
    const signature = signer.sign(key);
    const encodedSignature = base64url(signature);

    return `${dataToSign}.${encodedSignature}`;
}

beforeAll(async () => {
    modelRegistry.clear();
    skillRepositoryRegistry.clear();
    toolProviderRegistry.clear();
    // 1. Create temporary agent.yaml config for bootstrap
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "harness-test-"));
    tempConfigPath = path.join(tempDir, "agent.yaml");

    const sampleYamlContent = `
name: TestHarnessAgent
description: Test agent harness config
models:
  - brand: self_hosted
    name: test-model
    properties:
      baseUrl: "http://localhost:8080/v1"
skillRepositories: []
toolProviders: []
security:
  jwksUri: "https://example.com/jwks.json"
  alg:
    - RS256
  adminRoles:
    - admin
`;
    await fs.writeFile(tempConfigPath, sampleYamlContent, "utf8");
    process.env.AGENT_CONFIG_PATH = tempConfigPath;

    // 2. Ensure a default model is registered
    if (!modelRegistry.getDefaultModel()) {
        modelRegistry.registerModel(
            "test-model",
            new SelfHostedModel("http://localhost:8080/v1", "test-model"),
        );
    }

    // 3. Generate RSA Keypair
    const keys = crypto.generateKeyPairSync("rsa", {
        modulusLength: 2048,
    });
    privateKey = keys.privateKey;
    publicKey = keys.publicKey;

    publicJwk = publicKey.export({ format: "jwk" });
    publicJwk.alg = "RS256";
    publicJwk.use = "sig";
    publicJwk.kid = "test-key-id";

    // 4. Mock global fetch so hono/jwk resolves the public key
    originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: any, init?: any) => {
        const urlStr = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (urlStr.includes("example.com") || urlStr.includes("jwks")) {
            return new Response(JSON.stringify({ keys: [publicJwk] }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            });
        }
        return originalFetch(input, init);
    }) as typeof globalThis.fetch;

    const now = Math.floor(Date.now() / 1000);

    // 5. Create signed tokens for testing
    user1Token = signJwt(
        { sub: "user-1", roles: ["user"], iat: now, exp: now + 3600 },
        privateKey,
    );

    user2Token = signJwt(
        { sub: "user-2", roles: ["user"], iat: now, exp: now + 3600 },
        privateKey,
    );

    adminToken = signJwt(
        { sub: "admin-user", roles: ["admin"], iat: now, exp: now + 3600 },
        privateKey,
    );

    // 6. Dynamically import app after AGENT_CONFIG_PATH is set
    const module = await import("./index");
    app = module.default;
});

afterAll(async () => {
    modelRegistry.clear();
    skillRepositoryRegistry.clear();
    toolProviderRegistry.clear();
    if (originalFetch) {
        globalThis.fetch = originalFetch;
    }
    delete process.env.AGENT_CONFIG_PATH;
    if (tempConfigPath) {
        const dir = path.dirname(tempConfigPath);
        await fs.rm(dir, { recursive: true, force: true });
    }
});

describe("Harness API & Security Integration", () => {
    it("returns 200 for health check", async () => {
        const res = await app.request("/health");
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data).toEqual({ healthy: "OK" });
    });

    it("creates an interaction scoped to user-1", async () => {
        const createRes = await app.request("/interactions", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${user1Token}`,
            },
        });
        expect(createRes.status).toBe(200);
        const body = (await createRes.json()) as { id: string };
        expect(body.id).toBeDefined();

        // user-1 should see their interaction
        const listRes = await app.request("/interactions", {
            headers: {
                Authorization: `Bearer ${user1Token}`,
            },
        });
        expect(listRes.status).toBe(200);
        const listBody = (await listRes.json()) as Array<{ id: string }>;
        expect(listBody.some((item) => item.id === body.id)).toBe(true);

        // user-2 should NOT see user-1's interaction in listing
        const listUser2Res = await app.request("/interactions", {
            headers: {
                Authorization: `Bearer ${user2Token}`,
            },
        });
        expect(listUser2Res.status).toBe(200);
        const listUser2Body = (await listUser2Res.json()) as Array<{ id: string }>;
        expect(listUser2Body.some((item) => item.id === body.id)).toBe(false);

        // user-2 attempting to fetch user-1's interaction directly gets 404
        const getUser2Res = await app.request(`/interactions/${body.id}`, {
            headers: {
                Authorization: `Bearer ${user2Token}`,
            },
        });
        expect(getUser2Res.status).toBe(404);
    });

    it("restricts /admin/* endpoints to authorized admin roles", async () => {
        // Create an interaction as user-1
        const createRes = await app.request("/interactions", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${user1Token}`,
            },
        });
        const { id } = (await createRes.json()) as { id: string };

        // Non-admin token accessing /admin/interactions gets 403 Forbidden
        const nonAdminRes = await app.request("/admin/interactions", {
            headers: {
                Authorization: `Bearer ${user1Token}`,
            },
        });
        expect(nonAdminRes.status).toBe(403);

        // Admin token accessing /admin/interactions succeeds (returns 200 and all interactions)
        const adminRes = await app.request("/admin/interactions", {
            headers: {
                Authorization: `Bearer ${adminToken}`,
            },
        });
        expect(adminRes.status).toBe(200);
        const adminList = (await adminRes.json()) as Array<{ id: string }>;
        expect(adminList.some((item) => item.id === id)).toBe(true);

        // Admin token fetching specific interaction across users succeeds
        const adminGetRes = await app.request(`/admin/interactions/${id}`, {
            headers: {
                Authorization: `Bearer ${adminToken}`,
            },
        });
        expect(adminGetRes.status).toBe(200);
        const adminGetBody = (await adminGetRes.json()) as { id: string; userId: string };
        expect(adminGetBody.id).toBe(id);
        expect(adminGetBody.userId).toBe("user-1");
    });

    it("handles non-interactive interaction creation and prevents posting follow-up messages", async () => {
        const createRes = await app.request("/interactions", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${user1Token}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ mode: "non-interactive" }),
        });
        expect(createRes.status).toBe(200);
        const { id } = (await createRes.json()) as { id: string };

        const getRes = await app.request(`/interactions/${id}`, {
            headers: {
                Authorization: `Bearer ${user1Token}`,
            },
        });
        expect(getRes.status).toBe(200);
        const interaction = (await getRes.json()) as { id: string; mode: string };
        expect(interaction.mode).toBe("non-interactive");

        // First message when transcript is empty succeeds
        const firstMsgRes = await app.request(`/interactions/${id}`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${user1Token}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ message: "Hello non-interactive" }),
        });
        expect(firstMsgRes.status).toBe(200);

        // Second message when transcript is no longer empty returns 400
        const secondMsgRes = await app.request(`/interactions/${id}`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${user1Token}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ message: "Follow-up message" }),
        });
        expect(secondMsgRes.status).toBe(400);
    });
});
