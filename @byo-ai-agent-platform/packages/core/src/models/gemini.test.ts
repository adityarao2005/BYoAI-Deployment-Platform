import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { loadConfig } from "@/config/config";
import { normalizeGeminiFunctionResponse } from "./gemini";

const REGISTRY_FILE_PATH = "./models";

describe("Gemini Model Config Registration", () => {
    let tempConfigDir: string | undefined;

    async function writeConfig(models: Array<Record<string, unknown>>) {
        tempConfigDir = await mkdtemp(join(tmpdir(), "agent-gemini-config-"));
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
                name: "gemini",
                brand: "gemini",
                properties: {
                    apiKey: "sk-test-key-123",
                },
            },
        ]);

        const { registerGeminiModels } = await import("./gemini");
        registerGeminiModels(config);

        const { modelRegistry } = await import(REGISTRY_FILE_PATH);
        const registeredModels = modelRegistry.getAllModels();

        expect(registeredModels.has("gemini")).toBe(true);
        expect(registeredModels.size).toBe(1);
    });

    it("should register multiple models simultaneously", async () => {
        const config = await writeConfig([
            {
                name: "gemini",
                brand: "gemini",
                properties: {
                    apiKey: "sk-123",
                },
            },
            {
                name: "haiduke",
                brand: "gemini",
                properties: {
                    apiKey: "sk-456",
                },
            },
        ]);

        const { registerGeminiModels } = await import("./gemini");
        registerGeminiModels(config);

        const { modelRegistry } = await import(REGISTRY_FILE_PATH);
        const registeredModels = modelRegistry.getAllModels();
        expect(registeredModels.size).toBe(2);
        expect(registeredModels.has("gemini")).toBe(true);
        expect(registeredModels.has("haiduke")).toBe(true);
    });

    it("should skip registration when config contains no gemini models", async () => {
        const config = await writeConfig([
            {
                name: "openai-only",
                brand: "openai",
                properties: {
                    apiKey: "sk-only-key",
                },
            },
        ]);

        const { registerGeminiModels } = await import("./gemini");
        registerGeminiModels(config);

        const { modelRegistry } = await import(REGISTRY_FILE_PATH);
        const registeredModels = modelRegistry.getAllModels();
        expect(registeredModels.size).toBe(0);
    });
});

describe("normalizeGeminiFunctionResponse", () => {
    it("wraps scalar tool results in an object for Gemini", () => {
        expect(normalizeGeminiFunctionResponse("The weather is sunny."))
            .toEqual({ result: "The weather is sunny." });
    });

    it("preserves object-shaped tool results", () => {
        expect(normalizeGeminiFunctionResponse({ temperature: 25, condition: "sunny" }))
            .toEqual({ temperature: 25, condition: "sunny" });
    });

    it("maps undefined tool results to a Struct-safe null payload", () => {
        expect(normalizeGeminiFunctionResponse(undefined))
            .toEqual({ result: null });
    });
});