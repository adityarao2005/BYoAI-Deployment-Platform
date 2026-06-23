import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";

// Path to your model file that contains the registration logic
const MODEL_FILE_PATH = "./anthropic";
const REGISTRY_FILE_PATH = "./models"; // Path where modelRegistry lives

describe("Anthropic Model Environment Variable Registration", () => {
    let originalEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
        // 1. Take a snapshot of the original process.env
        originalEnv = { ...process.env };

        // 2. Clear the module cache for your specific model file
        // If using Jest: jest.resetModules();
        vi.resetModules();

        // 3. Clear the model registry map before each test if it has a clear method,
        // or ensure it starts fresh. (Assuming modelRegistry handles state or gets cleared)
    });

    afterEach(() => {
        // 4. Restore original env variables after each test run
        process.env = originalEnv;
    });

    it("should successfully register a model when valid env variables are provided", async () => {
        // Set up test environment variables
        process.env.ANTHROPIC_MODEL_API_KEY_ANTHROPIC = "sk-test-key-123";
        process.env.ANTHROPIC_MODEL_NAME_ANTHROPIC = "anthropic-2.5-flash";

        // Dynamically import the file to force execution of the registration logic
        await import(MODEL_FILE_PATH);

        // 2. Dynamically import the registry *after* cache reset to get the live instance
        const { modelRegistry } = await import(REGISTRY_FILE_PATH);
        // Get registered models from your registry
        // (Adjust this method name depending on how your modelRegistry exposes the maps)
        const registeredModels = modelRegistry.getAllModels();

        expect(registeredModels.has("anthropic")).toBe(true);
        // You can also verify that it skipped things it shouldn't have registered
        expect(registeredModels.size).toBe(1);
    });

    it("should register multiple models simultaneously", async () => {
        process.env.ANTHROPIC_MODEL_API_KEY_ANTHROPIC = "sk-123";
        process.env.ANTHROPIC_MODEL_NAME_ANTHROPIC = "anthropic-2.5-flash";

        process.env.ANTHROPIC_MODEL_API_KEY_HAIDUKE = "sk-456";
        process.env.ANTHROPIC_MODEL_NAME_HAIDUKE = "anthropic-2.5-turbo";

        await import(MODEL_FILE_PATH);

        const { modelRegistry } = await import(REGISTRY_FILE_PATH);
        const registeredModels = modelRegistry.getAllModels();
        expect(registeredModels.size).toBe(2);
        expect(registeredModels.has("anthropic")).toBe(true);
        expect(registeredModels.has("haiduke")).toBe(true);
    });

    it("should skip registration and log a warning if model name is missing", async () => {
        process.env.ANTHROPIC_MODEL_API_KEY_BROKEN = "sk-only-key";
        // Intentionally missing: process.env.ANTHROPIC_MODEL_NAME_BROKEN

        await import(MODEL_FILE_PATH);
        // 2. Dynamically import the registry *after* cache reset to get the live instance
        const { modelRegistry } = await import(REGISTRY_FILE_PATH);
        const registeredModels = modelRegistry.getAllModels();
        expect(registeredModels.size).toBe(0);
    });
});