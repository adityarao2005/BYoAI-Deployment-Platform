import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { RedisComputerLifecycleManager, RedisUserTokenManager } from "./index";

const shouldRunIntegration =
    process.env.RUN_INTEGRATION_TESTS === "true" ||
    process.env.RUN_INTEGRATION_TESTS === "1";

describe.skipIf(!shouldRunIntegration)(
    "Redis Persistence Integration Tests (Testcontainers)",
    () => {
        let redisContainer: StartedTestContainer;
        let redisPort: number;
        let redisHost: string;

        beforeAll(async () => {
            redisContainer = await new GenericContainer("redis:7-alpine")
                .withExposedPorts(6379)
                .start();
            redisHost = redisContainer.getHost();
            redisPort = redisContainer.getMappedPort(6379);
        }, 60000);

        afterAll(async () => {
            if (redisContainer) {
                await redisContainer.stop();
            }
        });

        it("persists and clears user tokens in live Redis", async () => {
            const tokenStore = new RedisUserTokenManager({
                host: redisHost,
                port: redisPort,
            });
            await tokenStore.init();

            await tokenStore.setUserToken("user-integ", {
                accessToken: "live-token-abc",
                tokenType: "Bearer",
                expiresAt: Date.now() + 60_000,
            });

            const loaded = await tokenStore.getUserToken("user-integ");
            expect(loaded).toBeDefined();
            expect(loaded?.accessToken).toBe("live-token-abc");

            await tokenStore.clearUserToken("user-integ");
            const afterClear = await tokenStore.getUserToken("user-integ");
            expect(afterClear).toBeUndefined();

            await tokenStore.destroy();
        });

        it("manages computer lifecycles in live Redis", async () => {
            const compStore = new RedisComputerLifecycleManager({
                host: redisHost,
                port: redisPort,
            });
            await compStore.init();

            const scope = {
                lifecycle: "user" as const,
                agentName: "agent-redis-test",
                userId: "user-123",
                interactionId: "int-456",
            };

            await compStore.setComputer(scope, {
                computerId: "container-789",
                lifecycle: "user",
                skillsPath: "/workspace/skills",
            });

            const loaded = await compStore.getComputer(scope);
            expect(loaded).toBeDefined();
            expect(loaded?.computerId).toBe("container-789");
            expect(loaded?.skillsPath).toBe("/workspace/skills");

            await compStore.removeComputer(scope);
            const afterRemove = await compStore.getComputer(scope);
            expect(afterRemove).toBeUndefined();

            await compStore.destroy();
        });
    },
);
