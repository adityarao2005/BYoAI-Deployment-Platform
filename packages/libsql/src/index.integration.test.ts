import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
    LibSqlAgentMemoryManager,
    LibSqlComputerLifecycleManager,
    LibSqlUserTokenManager,
} from "./index";

const TEST_DB_PATH = join(import.meta.dir, "..", "test_libsql_persistence.db");

describe("LibSQL File Persistence Integration Tests", () => {
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
        const mgr1 = new LibSqlUserTokenManager({ path: TEST_DB_PATH });
        await mgr1.setUserToken("user-libsql-disk", {
            accessToken: "libsql-disk-token",
            tokenType: "Bearer",
        });
        await mgr1.destroy();

        const mgr2 = new LibSqlUserTokenManager({ path: TEST_DB_PATH });
        const token = await mgr2.getUserToken("user-libsql-disk");
        expect(token?.accessToken).toBe("libsql-disk-token");
        await mgr2.destroy();
    });

    it("persists computer lifecycles across manager instances on disk", async () => {
        const scope = {
            lifecycle: "user" as const,
            agentName: "agent-libsql-disk",
            userId: "u-libsql-disk",
            interactionId: "int-libsql-disk",
        };

        const comp1 = new LibSqlComputerLifecycleManager({ path: TEST_DB_PATH });
        await comp1.setComputer(scope, {
            computerId: "comp-libsql-disk-1",
            lifecycle: "user",
            skillsPath: "/turso/disk/skills",
        });
        await comp1.destroy();

        const comp2 = new LibSqlComputerLifecycleManager({ path: TEST_DB_PATH });
        const session = await comp2.getComputer(scope);
        expect(session?.computerId).toBe("comp-libsql-disk-1");
        expect(session?.skillsPath).toBe("/turso/disk/skills");
        await comp2.destroy();
    });

    it("persists agent memories and transcripts across manager instances on disk", async () => {
        const mem1 = new LibSqlAgentMemoryManager({ path: TEST_DB_PATH });
        const id = await mem1.createAgentMemoryEntry(
            "LibSQL Disk Agent",
            "u-libsql-disk-2",
            "interactive",
        );
        await mem1.addTranscriptEntries(id, [
            {
                type: "message",
                role: "user",
                content: "Hello LibSQL Disk DB",
            },
        ]);
        await mem1.destroy();

        const mem2 = new LibSqlAgentMemoryManager({ path: TEST_DB_PATH });
        const agent = await mem2.getAgentMemory(id);
        expect(agent.name).toBe("LibSQL Disk Agent");
        expect(agent.transcript.length).toBe(1);
        expect((agent.transcript[0] as any)?.content).toBe("Hello LibSQL Disk DB");
        await mem2.destroy();
    });
});
