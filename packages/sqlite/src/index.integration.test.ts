import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
    SqliteAgentMemoryManager,
    SqliteComputerLifecycleManager,
    SqliteUserTokenManager,
} from "./index";

const TEST_DB_PATH = join(import.meta.dir, "..", "test_sqlite_persistence.db");

describe("SQLite File Persistence Integration Tests", () => {
    beforeAll(() => {
        if (existsSync(TEST_DB_PATH)) {
            rmSync(TEST_DB_PATH, { force: true });
        }
    });

    afterAll(() => {
        if (existsSync(TEST_DB_PATH)) {
            rmSync(TEST_DB_PATH, { force: true });
        }
    });

    it("persists user tokens across manager instances on disk", async () => {
        const mgr1 = new SqliteUserTokenManager({ path: TEST_DB_PATH });
        await mgr1.setUserToken("user-disk-1", {
            accessToken: "disk-token-xyz",
            tokenType: "Bearer",
        });
        await mgr1.destroy();

        const mgr2 = new SqliteUserTokenManager({ path: TEST_DB_PATH });
        const token = await mgr2.getUserToken("user-disk-1");
        expect(token?.accessToken).toBe("disk-token-xyz");
        await mgr2.destroy();
    });

    it("persists computer lifecycles across manager instances on disk", async () => {
        const scope = {
            lifecycle: "user" as const,
            agentName: "agent-disk",
            userId: "u-disk-1",
            interactionId: "int-disk-1",
        };

        const comp1 = new SqliteComputerLifecycleManager({ path: TEST_DB_PATH });
        await comp1.setComputer(scope, {
            computerId: "comp-disk-1",
            lifecycle: "user",
            skillsPath: "/disk/skills",
        });
        await comp1.destroy();

        const comp2 = new SqliteComputerLifecycleManager({ path: TEST_DB_PATH });
        const session = await comp2.getComputer(scope);
        expect(session?.computerId).toBe("comp-disk-1");
        expect(session?.skillsPath).toBe("/disk/skills");
        await comp2.destroy();
    });

    it("persists agent memories and transcripts across manager instances on disk", async () => {
        const mem1 = new SqliteAgentMemoryManager({ path: TEST_DB_PATH });
        const id = await mem1.createAgentMemoryEntry(
            "Disk Agent",
            "u-disk-2",
            "interactive",
        );
        await mem1.addTranscriptEntries(id, [
            {
                type: "message",
                role: "user",
                content: "Hello Disk DB",
            },
        ]);
        await mem1.destroy();

        const mem2 = new SqliteAgentMemoryManager({ path: TEST_DB_PATH });
        const agent = await mem2.getAgentMemory(id);
        expect(agent.name).toBe("Disk Agent");
        expect(agent.transcript.length).toBe(1);
        expect((agent.transcript[0] as any)?.content).toBe("Hello Disk DB");
        await mem2.destroy();
    });
});
