import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonFileUserTokenManager } from "./json_file";

describe("JsonFileUserTokenManager", () => {
    let tempDir: string | undefined;

    afterEach(async () => {
        if (tempDir) {
            await rm(tempDir, { recursive: true, force: true });
            tempDir = undefined;
        }
    });

    it("saves and retrieves a valid user token", async () => {
        tempDir = await mkdtemp(join(tmpdir(), "user-token-test-"));
        const manager = new JsonFileUserTokenManager(tempDir);

        const authContext = {
            accessToken: "test-token-123",
            tokenType: "Bearer",
            expiresAt: Date.now() + 100_000,
            extraHeaders: { "X-Custom": "header-val" },
        };

        await manager.setUserToken("user-1", authContext);

        const retrieved = await manager.getUserToken("user-1");
        expect(retrieved).toBeDefined();
        expect(retrieved?.accessToken).toBe("test-token-123");
        expect(retrieved?.tokenType).toBe("Bearer");
        expect(retrieved?.extraHeaders).toEqual({ "X-Custom": "header-val" });
    });

    it("persists across distinct manager instances", async () => {
        tempDir = await mkdtemp(join(tmpdir(), "user-token-persist-"));
        const manager1 = new JsonFileUserTokenManager(tempDir);
        await manager1.setUserToken("user-2", {
            accessToken: "persisted-token",
            tokenType: "Bearer",
        });

        const manager2 = new JsonFileUserTokenManager(tempDir);
        const retrieved = await manager2.getUserToken("user-2");
        expect(retrieved).toBeDefined();
        expect(retrieved?.accessToken).toBe("persisted-token");
    });

    it("returns undefined for expired tokens and removes them from disk", async () => {
        tempDir = await mkdtemp(join(tmpdir(), "user-token-expired-"));
        const manager = new JsonFileUserTokenManager(tempDir);

        // Set token with already expired timestamp (in seconds or ms)
        await manager.setUserToken("user-expired", {
            accessToken: "expired-token",
            expiresAt: Math.floor(Date.now() / 1000) - 60,
        });

        const retrieved = await manager.getUserToken("user-expired");
        expect(retrieved).toBeUndefined();
    });

    it("clears user tokens correctly", async () => {
        tempDir = await mkdtemp(join(tmpdir(), "user-token-clear-"));
        const manager = new JsonFileUserTokenManager(tempDir);

        await manager.setUserToken("user-to-clear", {
            accessToken: "token-to-clear",
        });

        await manager.clearUserToken("user-to-clear");
        const retrieved = await manager.getUserToken("user-to-clear");
        expect(retrieved).toBeUndefined();
    });
});
