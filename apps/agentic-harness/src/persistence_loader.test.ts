import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    InMemoryAgentMemoryManager,
    InMemoryComputerLifecycleManager,
    InMemoryUserTokenManager,
    JsonFileAgentMemoryManager,
    JsonFileComputerLifecycleManager,
    JsonFileUserTokenManager,
} from "@byo-ai-agent-platform/core/agents";
import {
    PersistenceConfigSchema,
    normalizePersistenceConfig,
    normalizeSingleStoreConfig,
} from "./agent.config";
import {
    createAgentMemoryManager,
    createComputerLifecycleManager,
    createUnifiedMemoryManager,
    createUserTokenManager,
} from "./persistence_loader";

describe("PersistenceConfigSchema & normalizePersistenceConfig", () => {
    it("defaults to in_memory for all stores when undefined", () => {
        const parsed = PersistenceConfigSchema.parse(undefined);
        expect(parsed).toBe("in_memory");

        const normalized = normalizePersistenceConfig(parsed);
        expect(normalized.chatMemory.type).toBe("in_memory");
        expect(normalized.tokenStore.type).toBe("in_memory");
        expect(normalized.computerStore.type).toBe("in_memory");
    });

    it("normalizes top-level json_files shorthand to all three stores", () => {
        const parsed = PersistenceConfigSchema.parse("json_files");
        expect(parsed).toBe("json_files");

        const normalized = normalizePersistenceConfig(parsed);
        expect(normalized.chatMemory.type).toBe("json_files");
        expect(normalized.tokenStore.type).toBe("json_files");
        expect(normalized.computerStore.type).toBe("json_files");
    });

    it("normalizes mix-and-match object configuration", () => {
        const parsed = PersistenceConfigSchema.parse({
            chatMemory: {
                provider: "@byo-ai-agent-platform/postgres",
                properties: {
                    url: "postgresql://localhost:5432",
                },
            },
            tokenStore: {
                provider: "@byo-ai-agent-platform/redis",
            },
            computerStore: {
                provider: "@byo-ai-agent-platform/mongo",
            },
        });

        const normalized = normalizePersistenceConfig(parsed);
        expect(normalized.chatMemory.type).toBe("dynamic");
        expect(normalized.chatMemory.provider).toBe(
            "@byo-ai-agent-platform/postgres",
        );
        expect(normalized.chatMemory.properties).toEqual({
            url: "postgresql://localhost:5432",
        });

        expect(normalized.tokenStore.type).toBe("dynamic");
        expect(normalized.tokenStore.provider).toBe(
            "@byo-ai-agent-platform/redis",
        );

        expect(normalized.computerStore.type).toBe("dynamic");
        expect(normalized.computerStore.provider).toBe(
            "@byo-ai-agent-platform/mongo",
        );
    });

    it("handles aliases chatHistory, userToken, and computerLifecycle", () => {
        const parsed = PersistenceConfigSchema.parse({
            chatHistory: "json_files",
            userToken: "in_memory",
            computerLifecycle: "json_files",
        });

        const normalized = normalizePersistenceConfig(parsed);
        expect(normalized.chatMemory.type).toBe("json_files");
        expect(normalized.tokenStore.type).toBe("in_memory");
        expect(normalized.computerStore.type).toBe("json_files");
    });

    it("supports package key and array properties", () => {
        const parsed = PersistenceConfigSchema.parse({
            chatMemory: {
                package: "custom-db-package",
                properties: ["URL=postgres://localhost/test", "DEBUG=true"],
            },
        });

        const normalized = normalizePersistenceConfig(parsed);
        expect(normalized.chatMemory.type).toBe("dynamic");
        expect(normalized.chatMemory.provider).toBe("custom-db-package");
        expect(normalized.chatMemory.properties).toEqual({
            URL: "postgres://localhost/test",
            DEBUG: "true",
        });
        expect(normalized.tokenStore.type).toBe("in_memory");
        expect(normalized.computerStore.type).toBe("in_memory");
    });
});

describe("Persistence Loaders (Built-in)", () => {
    let tempDir: string | undefined;

    afterEach(async () => {
        if (tempDir) {
            await rm(tempDir, { recursive: true, force: true });
            tempDir = undefined;
        }
    });

    it("loads InMemoryAgentMemoryManager and JsonFileAgentMemoryManager", async () => {
        const inMem = await createAgentMemoryManager("in_memory");
        expect(inMem).toBeInstanceOf(InMemoryAgentMemoryManager);

        tempDir = await mkdtemp(join(tmpdir(), "chat-persist-"));
        const jsonFile = await createAgentMemoryManager({
            provider: "json_files",
            properties: { dir: tempDir },
        });
        expect(jsonFile).toBeInstanceOf(JsonFileAgentMemoryManager);
    });

    it("loads InMemoryUserTokenManager and JsonFileUserTokenManager", async () => {
        const inMem = await createUserTokenManager("in_memory");
        expect(inMem).toBeInstanceOf(InMemoryUserTokenManager);

        tempDir = await mkdtemp(join(tmpdir(), "token-persist-"));
        const jsonFile = await createUserTokenManager({
            provider: "json_files",
            properties: { dir: tempDir },
        });
        expect(jsonFile).toBeInstanceOf(JsonFileUserTokenManager);
    });

    it("loads InMemoryComputerLifecycleManager and JsonFileComputerLifecycleManager", async () => {
        const inMem = await createComputerLifecycleManager("in_memory");
        expect(inMem).toBeInstanceOf(InMemoryComputerLifecycleManager);

        tempDir = await mkdtemp(join(tmpdir(), "comp-persist-"));
        const jsonFile = await createComputerLifecycleManager({
            provider: "json_files",
            properties: { dir: tempDir },
        });
        expect(jsonFile).toBeInstanceOf(JsonFileComputerLifecycleManager);
    });

    it("creates a unified CompositeMemoryManager", async () => {
        tempDir = await mkdtemp(join(tmpdir(), "unified-persist-"));
        const memory = await createUnifiedMemoryManager({
            chatMemory: "in_memory",
            tokenStore: { provider: "json_files", properties: { dir: tempDir } },
            computerStore: "in_memory",
        });

        expect(memory.agent).toBeInstanceOf(InMemoryAgentMemoryManager);
        expect(memory.userToken).toBeInstanceOf(JsonFileUserTokenManager);
        expect(memory.computerLifecycle).toBeInstanceOf(
            InMemoryComputerLifecycleManager,
        );
    });
});

describe("Dynamic Persistence Module Loading", () => {
    let tempDir: string | undefined;

    afterEach(async () => {
        if (tempDir) {
            await rm(tempDir, { recursive: true, force: true });
            tempDir = undefined;
        }
    });

    it("dynamically loads custom chat memory provider with class export", async () => {
        tempDir = await mkdtemp(join(tmpdir(), "custom-chat-"));
        const modulePath = join(tempDir, "custom-chat.ts");

        await writeFile(
            modulePath,
            `
export default class CustomChatMemory {
    public inited = false;
    public props: any;

    constructor(props: any) {
        this.props = props;
    }

    async init() {
        this.inited = true;
    }

    async createAgentMemoryEntry() { return "agent-1"; }
    async getAgentMemory() { return {} as any; }
    async addTranscriptEntries() {}
    async setComputerId() {}
    async setSkillsPath() {}
    async setName() {}
    async getAgent() { return undefined; }
    async getAgentByUser() { return undefined; }
    async getAllAgents() { return []; }
    async getAllAgentsByUser() { return []; }
    async getSubAgents() { return []; }
}
            `,
            "utf8",
        );

        const manager = await createAgentMemoryManager({
            provider: modulePath,
            properties: { testProp: "123" },
        });

        expect(manager).toBeDefined();
        expect((manager as any).inited).toBe(true);
        expect((manager as any).props).toEqual({ testProp: "123" });
    });

    it("dynamically loads custom user token store with factory export", async () => {
        tempDir = await mkdtemp(join(tmpdir(), "custom-token-"));
        const modulePath = join(tempDir, "custom-token.ts");

        await writeFile(
            modulePath,
            `
export function createTokenStore(props: any) {
    return {
        props,
        async getUserToken() { return undefined; },
        async setUserToken() {},
        async clearUserToken() {},
    };
}
            `,
            "utf8",
        );

        const manager = await createUserTokenManager({
            provider: modulePath,
            properties: { redisUrl: "redis://localhost:6379" },
        });

        expect(manager).toBeDefined();
        expect((manager as any).props).toEqual({
            redisUrl: "redis://localhost:6379",
        });
    });

    it("dynamically loads custom computer store with named class export", async () => {
        tempDir = await mkdtemp(join(tmpdir(), "custom-comp-"));
        const modulePath = join(tempDir, "custom-comp.ts");

        await writeFile(
            modulePath,
            `
export class ComputerStore {
    public props: any;
    constructor(props: any) { this.props = props; }
    async getComputer() { return undefined; }
    async setComputer() {}
    async removeComputer() {}
    async clear() {}
}
            `,
            "utf8",
        );

        const manager = await createComputerLifecycleManager({
            provider: modulePath,
            properties: { mongoUrl: "mongodb://localhost:27017" },
        });

        expect(manager).toBeDefined();
        expect((manager as any).props).toEqual({
            mongoUrl: "mongodb://localhost:27017",
        });
    });

    it("throws ConfigError when required methods are missing", async () => {
        tempDir = await mkdtemp(join(tmpdir(), "invalid-comp-"));
        const modulePath = join(tempDir, "invalid-comp.ts");

        await writeFile(
            modulePath,
            `
export default class IncompleteComputerStore {
    async getComputer() { return undefined; }
    // Missing setComputer, removeComputer, clear
}
            `,
            "utf8",
        );

        expect(
            createComputerLifecycleManager({ provider: modulePath }),
        ).rejects.toThrow();
    });
});
