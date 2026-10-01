import { describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
    type ComputerLifecycleScope,
    type ComputerSessionRecord,
    getComputerLifecycleStorageKey,
} from "../agent.computer_lifecycle";
import { InMemoryComputerLifecycleManager } from "./in_memory";
import { JsonFileComputerLifecycleManager } from "./json_file";

describe("Computer Lifecycle Storage Keys", () => {
    it("generates correct keys for server, user, and interaction lifecycles", () => {
        const serverScope: ComputerLifecycleScope = {
            lifecycle: "server",
            agentName: "AgentSmith",
            userId: "user-1",
            interactionId: "int-100",
        };
        expect(getComputerLifecycleStorageKey(serverScope)).toBe(
            "server:AgentSmith",
        );

        const userScope: ComputerLifecycleScope = {
            lifecycle: "user",
            agentName: "AgentSmith",
            userId: "user-1",
            interactionId: "int-100",
        };
        expect(getComputerLifecycleStorageKey(userScope)).toBe(
            "user:AgentSmith:user-1",
        );

        const interactionScope: ComputerLifecycleScope = {
            lifecycle: "interaction",
            agentName: "AgentSmith",
            userId: "user-1",
            interactionId: "int-100",
        };
        expect(getComputerLifecycleStorageKey(interactionScope)).toBe(
            "interaction:int-100",
        );
    });
});

describe("InMemoryComputerLifecycleManager", () => {
    it("performs get, set, remove, and clear operations correctly", async () => {
        const manager = new InMemoryComputerLifecycleManager();

        const scope: ComputerLifecycleScope = {
            lifecycle: "user",
            agentName: "TestAgent",
            userId: "user-1",
            interactionId: "int-1",
        };

        const record: ComputerSessionRecord = {
            computerId: "comp-123",
            lifecycle: "user",
            skillsPath: "/workspace/skills",
            createdAt: Date.now(),
        };

        expect(await manager.getComputer(scope)).toBeUndefined();

        await manager.setComputer(scope, record);
        const retrieved = await manager.getComputer(scope);
        expect(retrieved).toBeDefined();
        expect(retrieved?.computerId).toBe("comp-123");
        expect(retrieved?.skillsPath).toBe("/workspace/skills");

        await manager.removeComputer(scope);
        expect(await manager.getComputer(scope)).toBeUndefined();

        await manager.setComputer(scope, record);
        await manager.clear();
        expect(await manager.getComputer(scope)).toBeUndefined();
    });
});

describe("JsonFileComputerLifecycleManager", () => {
    it("persists records to disk and reloads them correctly", async () => {
        const tempDir = await fs.mkdtemp(
            path.join(os.tmpdir(), "computer-lifecycle-test-"),
        );

        try {
            const manager = new JsonFileComputerLifecycleManager(tempDir);

            const scope: ComputerLifecycleScope = {
                lifecycle: "server",
                agentName: "SharedAgent",
                userId: "user-1",
                interactionId: "int-1",
            };

            const record: ComputerSessionRecord = {
                computerId: "comp-server-999",
                lifecycle: "server",
                skillsPath: "/app/skills",
                createdAt: Date.now(),
            };

            expect(await manager.getComputer(scope)).toBeUndefined();

            await manager.setComputer(scope, record);

            // Create fresh manager pointing to same directory to verify persistence
            const manager2 = new JsonFileComputerLifecycleManager(tempDir);
            const retrieved = await manager2.getComputer(scope);
            expect(retrieved).toBeDefined();
            expect(retrieved?.computerId).toBe("comp-server-999");
            expect(retrieved?.skillsPath).toBe("/app/skills");

            await manager2.removeComputer(scope);
            expect(await manager2.getComputer(scope)).toBeUndefined();

            await manager2.setComputer(scope, record);
            await manager2.clear();
            expect(await manager2.getComputer(scope)).toBeUndefined();
        } finally {
            await fs.rm(tempDir, { recursive: true, force: true });
        }
    });
});
