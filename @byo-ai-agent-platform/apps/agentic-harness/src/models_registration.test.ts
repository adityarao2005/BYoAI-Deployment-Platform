import { beforeEach, describe, expect, it } from "bun:test";
import { modelRegistry } from "@byo-ai-agent-platform/core/models";
import type { AgentConfig } from "@byo-ai-agent-platform/core/config";
import { registerModels } from "./bootstrap";

describe("Model Config Registration", () => {
    beforeEach(() => {
        modelRegistry.getAllModels().clear();
    });

    it("registers openai models when valid config is provided", () => {
        const config: AgentConfig = {
            models: [
                {
                    name: "gpt4",
                    brand: "openai",
                    properties: {
                        apiKey: "sk-test-key-123",
                    },
                },
            ],
            skillRepositories: [],
            toolProviders: [],
        };

        registerModels(config);

        const registered = modelRegistry.getAllModels();
        expect(registered.has("gpt4")).toBe(true);
        expect(registered.size).toBe(1);
    });

    it("registers anthropic models with maxTokens", () => {
        const config: AgentConfig = {
            models: [
                {
                    name: "claude-3-5-sonnet",
                    brand: "anthropic",
                    properties: {
                        apiKey: "sk-ant-test",
                        maxTokens: 4096,
                    },
                },
            ],
            skillRepositories: [],
            toolProviders: [],
        };

        registerModels(config);

        const registered = modelRegistry.getAllModels();
        expect(registered.has("claude-3-5-sonnet")).toBe(true);
        expect(registered.size).toBe(1);
    });

    it("registers gemini models", () => {
        const config: AgentConfig = {
            models: [
                {
                    name: "gemini-pro",
                    brand: "gemini",
                    properties: {
                        apiKey: "ai-gemini-key",
                    },
                },
            ],
            skillRepositories: [],
            toolProviders: [],
        };

        registerModels(config);

        const registered = modelRegistry.getAllModels();
        expect(registered.has("gemini-pro")).toBe(true);
        expect(registered.size).toBe(1);
    });

    it("registers self-hosted models without requiring apiKey", () => {
        const config: AgentConfig = {
            models: [
                {
                    name: "local-gemma",
                    brand: "self_hosted",
                    properties: {
                        baseUrl: "http://localhost:8080/v1",
                    },
                },
            ],
            skillRepositories: [],
            toolProviders: [],
        };

        registerModels(config);

        const registered = modelRegistry.getAllModels();
        expect(registered.has("local-gemma")).toBe(true);
        expect(registered.size).toBe(1);
    });

    it("registers multiple models simultaneously across brands", () => {
        const config: AgentConfig = {
            models: [
                {
                    name: "gpt4",
                    brand: "openai",
                    properties: {
                        apiKey: "sk-123",
                    },
                },
                {
                    name: "gemini",
                    brand: "gemini",
                    properties: {
                        apiKey: "sk-456",
                    },
                },
                {
                    name: "local",
                    brand: "self_hosted",
                    properties: {
                        baseUrl: "http://localhost:8080/v1",
                        apiKey: "local-key",
                    },
                },
            ],
            skillRepositories: [],
            toolProviders: [],
        };

        registerModels(config);

        const registered = modelRegistry.getAllModels();
        expect(registered.size).toBe(3);
        expect(registered.has("gpt4")).toBe(true);
        expect(registered.has("gemini")).toBe(true);
        expect(registered.has("local")).toBe(true);
    });

    it("skips models missing required API keys", () => {
        const config: AgentConfig = {
            models: [
                {
                    name: "broken-openai",
                    brand: "openai",
                    properties: {
                        apiKey: "",
                    },
                },
                {
                    name: "broken-anthropic",
                    brand: "anthropic",
                    properties: {
                        apiKey: "",
                        maxTokens: 1024,
                        
                    },
                },
            ],
            skillRepositories: [],
            toolProviders: [],
        };

        registerModels(config);

        const registered = modelRegistry.getAllModels();
        expect(registered.size).toBe(0);
    });
});
