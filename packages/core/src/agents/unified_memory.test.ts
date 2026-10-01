import { describe, expect, it } from "bun:test";
import {
    CompositeMemoryManager,
    isMemoryManager,
    normalizeMemoryManager,
} from "./agent.unified_memory";
import { InMemoryAgentMemoryManager } from "./memory";
import { InMemoryUserTokenManager } from "./auth";
import { InMemoryComputerLifecycleManager } from "./computer_lifecycle";

describe("Unified MemoryManager", () => {
    it("CompositeMemoryManager initializes default in-memory sub-managers", () => {
        const memory = new CompositeMemoryManager();
        expect(memory.agent).toBeInstanceOf(InMemoryAgentMemoryManager);
        expect(memory.userToken).toBeInstanceOf(InMemoryUserTokenManager);
        expect(memory.computerLifecycle).toBeInstanceOf(
            InMemoryComputerLifecycleManager,
        );
    });

    it("CompositeMemoryManager accepts custom sub-managers", () => {
        const agent = new InMemoryAgentMemoryManager();
        const userToken = new InMemoryUserTokenManager();
        const computerLifecycle = new InMemoryComputerLifecycleManager();

        const memory = new CompositeMemoryManager({
            agent,
            userToken,
            computerLifecycle,
        });

        expect(memory.agent).toBe(agent);
        expect(memory.userToken).toBe(userToken);
        expect(memory.computerLifecycle).toBe(computerLifecycle);
    });

    it("isMemoryManager correctly identifies MemoryManager instances", () => {
        const composite = new CompositeMemoryManager();
        expect(isMemoryManager(composite)).toBe(true);

        const legacyAgentMemory = new InMemoryAgentMemoryManager();
        expect(isMemoryManager(legacyAgentMemory)).toBe(false);
        expect(isMemoryManager(null)).toBe(false);
        expect(isMemoryManager(undefined)).toBe(false);
        expect(isMemoryManager({})).toBe(false);
    });

    it("normalizeMemoryManager wraps legacy AgentMemoryManager into full MemoryManager", () => {
        const legacyAgentMemory = new InMemoryAgentMemoryManager();
        const customToken = new InMemoryUserTokenManager();
        const customComputer = new InMemoryComputerLifecycleManager();

        const normalized = normalizeMemoryManager(legacyAgentMemory, {
            userTokenManager: customToken,
            computerLifecycleManager: customComputer,
        });

        expect(isMemoryManager(normalized)).toBe(true);
        expect(normalized.agent).toBe(legacyAgentMemory);
        expect(normalized.userToken).toBe(customToken);
        expect(normalized.computerLifecycle).toBe(customComputer);
    });

    it("normalizeMemoryManager passes through existing MemoryManager instances", () => {
        const composite = new CompositeMemoryManager();
        const normalized = normalizeMemoryManager(composite);
        expect(normalized).toBe(composite);
    });
});
