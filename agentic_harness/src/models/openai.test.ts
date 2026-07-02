import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { loadConfig } from "@/config/config";

const REGISTRY_FILE_PATH = "./models";

describe("OpenAI Model Config Registration", () => {
    let tempConfigDir: string | undefined;

    async function writeConfig(models: Array<Record<string, unknown>>) {
        tempConfigDir = await mkdtemp(join(tmpdir(), "agent-openai-config-"));
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
                name: "gpt4",
                brand: "openai",
                properties: {
                    apiKey: "sk-test-key-123",
                },
            },
        ]);

        expect(config.models).toHaveLength(1);

        const { registerOpenAIModels } = await import("./openai");
        registerOpenAIModels(config);

        const { modelRegistry } = await import(REGISTRY_FILE_PATH);
        const registeredModels = modelRegistry.getAllModels();

        expect(registeredModels.has("gpt4")).toBe(true);
        expect(registeredModels.size).toBe(1);
    });

    it("should register multiple models simultaneously", async () => {
        const config = await writeConfig([
            {
                name: "gpt4",
                brand: "openai",
                properties: {
                    apiKey: "sk-123",
                },
            },
            {
                name: "haiduke",
                brand: "openai",
                properties: {
                    apiKey: "sk-456",
                },
            },
            {
                name: "ignored-gemini",
                brand: "gemini",
                properties: {
                    apiKey: "sk-other",
                },
            },
        ]);

        const { registerOpenAIModels } = await import("./openai");
        registerOpenAIModels(config);

        const { modelRegistry } = await import(REGISTRY_FILE_PATH);
        const registeredModels = modelRegistry.getAllModels();
        expect(registeredModels.size).toBe(2);
        expect(registeredModels.has("gpt4")).toBe(true);
        expect(registeredModels.has("haiduke")).toBe(true);
    });

    it("should skip registration when no openai models are present", async () => {
        const config = await writeConfig([
            {
                name: "gemini-only",
                brand: "gemini",
                properties: {
                    apiKey: "sk-only-key",
                },
            },
        ]);

        const { registerOpenAIModels } = await import("./openai");
        registerOpenAIModels(config);

        const { modelRegistry } = await import(REGISTRY_FILE_PATH);
        const registeredModels = modelRegistry.getAllModels();
        expect(registeredModels.size).toBe(0);
    });
});