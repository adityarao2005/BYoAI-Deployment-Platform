import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { loadConfig } from "@/config/config";

const REGISTRY_FILE_PATH = "./models";

describe("Self-Hosted Model Config Registration", () => {
    let tempConfigDir: string | undefined;

    async function writeConfig(models: Array<Record<string, unknown>>) {
        tempConfigDir = await mkdtemp(join(tmpdir(), "agent-self-hosted-config-"));
        const configPath = join(tempConfigDir, "agent.yaml");
        await writeFile(configPath, stringify({ models }), "utf8");
        return loadConfig(configPath);
    }

    beforeEach(() => {
        vi.resetModules();
    });

    afterEach(() => {
        if (tempConfigDir) {
            return rm(tempConfigDir, { recursive: true, force: true });
        }
    });

    it("should successfully register a model when valid config is provided", async () => {
        const config = await writeConfig([
            {
                name: "base",
                brand: "self_hosted",
                properties: {
                    baseUrl: "http://example.com/v1",
                    apiKey: "sk-test-key-123",
                },
            },
        ]);

        const { registerSelfHostedModels } = await import("./self_hosted");
        registerSelfHostedModels(config);

        const { modelRegistry } = await import(REGISTRY_FILE_PATH);
        const registeredModels = modelRegistry.getAllModels();

        expect(registeredModels.has("base")).toBe(true);
        expect(registeredModels.size).toBe(1);
    });

    it("should successfully register model even when API key is missing", async () => {
        const config = await writeConfig([
            {
                name: "base",
                brand: "self_hosted",
                properties: {
                    baseUrl: "http://example.com/v1",
                },
            },
        ]);

        const { registerSelfHostedModels } = await import("./self_hosted");
        registerSelfHostedModels(config);

        const { modelRegistry } = await import(REGISTRY_FILE_PATH);
        const registeredModels = modelRegistry.getAllModels();

        expect(registeredModels.has("base")).toBe(true);
        expect(registeredModels.size).toBe(1);
    });

    it("should register multiple models simultaneously", async () => {
        const config = await writeConfig([
            {
                name: "gpt4",
                brand: "self_hosted",
                properties: {
                    baseUrl: "http://example.com/v2",
                    apiKey: "sk-123",
                },
            },
            {
                name: "haiduke",
                brand: "self_hosted",
                properties: {
                    baseUrl: "http://example.com/v1",
                    apiKey: "sk-456",
                },
            },
        ]);

        const { registerSelfHostedModels } = await import("./self_hosted");
        registerSelfHostedModels(config);

        const { modelRegistry } = await import(REGISTRY_FILE_PATH);
        const registeredModels = modelRegistry.getAllModels();
        expect(registeredModels.size).toBe(2);
        expect(registeredModels.has("gpt4")).toBe(true);
        expect(registeredModels.has("haiduke")).toBe(true);
    });

    it("should skip registration when config contains no self-hosted models", async () => {
        const config = await writeConfig([
            {
                name: "broken",
                brand: "openai",
                properties: {
                    apiKey: "sk-only-key",
                },
            },
        ]);

        const { registerSelfHostedModels } = await import("./self_hosted");
        registerSelfHostedModels(config);

        const { modelRegistry } = await import(REGISTRY_FILE_PATH);
        const registeredModels = modelRegistry.getAllModels();
        expect(registeredModels.size).toBe(0);
    });
});