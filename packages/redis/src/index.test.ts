import { describe, expect, it, mock } from "bun:test";
import {
    RedisComputerLifecycleManager,
    RedisUserTokenManager,
    createComputerStore,
    createTokenStore,
} from "./index";

describe("RedisUserTokenManager Unit Tests", () => {
    it("instantiates via class and factory function", () => {
        const tokenStore = new RedisUserTokenManager({ url: "redis://localhost:6379" });
        expect(tokenStore).toBeInstanceOf(RedisUserTokenManager);

        const factoryStore = createTokenStore({ url: "redis://localhost:6379" });
        expect(factoryStore).toBeInstanceOf(RedisUserTokenManager);
    });

    it("gets and sets user tokens with TTL", async () => {
        const store = new RedisUserTokenManager({ keyPrefix: "test:token:" });
        const redisMock = store.client;

        const setCalls: any[] = [];
        redisMock.set = mock(async (...args: any[]) => {
            setCalls.push(args);
            return "OK";
        });

        redisMock.get = mock(async (key: string) => {
            if (key === "test:token:user-1") {
                return JSON.stringify({
                    accessToken: "tok-1",
                    tokenType: "Bearer",
                    expiresAt: Date.now() + 60_000,
                });
            }
            return null;
        });

        const futureTime = Date.now() + 100_000;
        await store.setUserToken("user-1", {
            accessToken: "tok-1",
            tokenType: "Bearer",
            expiresAt: futureTime,
        });

        expect(setCalls).toHaveLength(1);
        expect(setCalls[0][0]).toBe("test:token:user-1");
        expect(setCalls[0][2]).toBe("EX");
        expect(typeof setCalls[0][3]).toBe("number");

        const token = await store.getUserToken("user-1");
        expect(token).toBeDefined();
        expect(token?.accessToken).toBe("tok-1");
    });

    it("clears user tokens", async () => {
        const store = new RedisUserTokenManager({ keyPrefix: "test:token:" });
        const redisMock = store.client;

        const delCalls: any[] = [];
        redisMock.del = mock(async (...args: any[]) => {
            delCalls.push(args);
            return 1;
        });

        await store.clearUserToken("user-2");
        expect(delCalls).toHaveLength(1);
        expect(delCalls[0][0]).toBe("test:token:user-2");
    });
});

describe("RedisComputerLifecycleManager Unit Tests", () => {
    it("instantiates via class and factory function", () => {
        const compStore = new RedisComputerLifecycleManager({ url: "redis://localhost:6379" });
        expect(compStore).toBeInstanceOf(RedisComputerLifecycleManager);

        const factoryStore = createComputerStore({ url: "redis://localhost:6379" });
        expect(factoryStore).toBeInstanceOf(RedisComputerLifecycleManager);
    });

    it("sets, gets, and removes computer sessions", async () => {
        const store = new RedisComputerLifecycleManager({ keyPrefix: "test:comp:" });
        const redisMock = store.client;

        const setCalls: any[] = [];
        redisMock.set = mock(async (...args: any[]) => {
            setCalls.push(args);
            return "OK";
        });

        redisMock.get = mock(async (key: string) => {
            if (key.includes("interaction:int-1")) {
                return JSON.stringify({
                    computerId: "comp-99",
                    lifecycle: "interaction",
                });
            }
            return null;
        });

        const scope = {
            lifecycle: "interaction" as const,
            agentName: "agent-a",
            userId: "u-1",
            interactionId: "int-1",
        };

        await store.setComputer(scope, {
            computerId: "comp-99",
            lifecycle: "interaction",
        });

        expect(setCalls).toHaveLength(1);
        expect(setCalls[0][0]).toBe("test:comp:interaction:int-1");

        const rec = await store.getComputer(scope);
        expect(rec).toBeDefined();
        expect(rec?.computerId).toBe("comp-99");

        const delCalls: any[] = [];
        redisMock.del = mock(async (...args: any[]) => {
            delCalls.push(args);
            return 1;
        });

        await store.removeComputer(scope);
        expect(delCalls).toHaveLength(1);
        expect(delCalls[0][0]).toBe("test:comp:interaction:int-1");
    });
});
