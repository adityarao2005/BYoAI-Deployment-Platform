import { beforeEach, describe, expect, it } from "bun:test";
import { toolProviderRegistry } from "@byo-ai-agent-platform/core/tools";
import type { AgentConfig } from "@byo-ai-agent-platform/core/config";
import type { Agent } from "@byo-ai-agent-platform/core/agents";
import { registerComputer, registerToolProviders } from "./bootstrap";

describe("Tool Provider Registration", () => {
    beforeEach(() => {
        toolProviderRegistry.getAllToolProviders().length = 0;
    });

    it("registers openapi tool providers from config", () => {
        const config: AgentConfig = {
            models: [],
            skillRepositories: [],
            toolProviders: [
                {
                    name: "my-openapi-service",
                    type: "openapi",
                    specUrl: "http://example.com/spec.json",
                    securityVariables: { type: "bearerToken", token: "abc" },
                },
            ],
        };

        registerToolProviders(config);

        const providers = toolProviderRegistry.getAllToolProviders();
        expect(providers).toHaveLength(1);
    });

    it("registers local computer use tool provider from config", () => {
        const config: AgentConfig = {
            models: [],
            skillRepositories: [],
            toolProviders: [
                {
                    type: "computer",
                    provider: {
                        type: "local",
                        enableGUIToolsIfAvailable: false,
                    },
                },
            ],
        };

        registerToolProviders(config);

        const providers = toolProviderRegistry.getAllToolProviders();
        expect(providers).toHaveLength(1);
    });

    it("registers remote computer use tool provider from config", () => {
        const config: AgentConfig = {
            models: [],
            skillRepositories: [],
            toolProviders: [
                {
                    type: "computer",
                    provider: {
                        type: "remote",
                        url: "http://localhost:8080",
                        image: "ubuntu:latest",
                        enableGUIToolsIfAvailable: true,
                        envFile: "",
                    },
                },
            ],
        };

        registerToolProviders(config);

        const providers = toolProviderRegistry.getAllToolProviders();
        expect(providers).toHaveLength(1);
    });

    it("throws if more than 1 computer tool provider is configured", () => {
        const config: AgentConfig = {
            models: [],
            skillRepositories: [],
            toolProviders: [
                {
                    type: "computer",
                    provider: { type: "local", enableGUIToolsIfAvailable: false },
                },
                {
                    type: "computer",
                    provider: {
                        type: "remote",
                        url: "http://localhost",
                        image: "ubuntu",
                        enableGUIToolsIfAvailable: true,
                        envFile: "",
                    },
                },
            ],
        };

        expect(() => registerToolProviders(config)).toThrow("There should only be 1 computer use tool provider declared");
    });

    it("requires agent to have computerId when getting tools from registered local provider", async () => {
        const config: AgentConfig = {
            models: [],
            skillRepositories: [],
            toolProviders: [
                {
                    type: "computer",
                    provider: {
                        type: "local",
                        enableGUIToolsIfAvailable: false,
                    },
                },
            ],
        };

        registerToolProviders(config);

        const providers = toolProviderRegistry.getAllToolProviders();
        expect(providers).toHaveLength(1);

        const computerProvider = providers[0];
        const agent: Agent = { id: "test-agent", name: "test-agent" };

        await expect(computerProvider?.getAllTools(agent)).rejects.toThrow(
            "The Agent is not registered with this tool provider and thus the agent does not have a computer id"
        );
    });

    it("requires agent to have computerId when getting tools from registered remote provider", async () => {
        const config: AgentConfig = {
            models: [],
            skillRepositories: [],
            toolProviders: [
                {
                    type: "computer",
                    provider: {
                        type: "remote",
                        url: "http://localhost:8080",
                        image: "ubuntu:latest",
                        enableGUIToolsIfAvailable: true,
                        envFile: "",
                    },
                },
            ],
        };

        registerToolProviders(config);

        const providers = toolProviderRegistry.getAllToolProviders();
        expect(providers).toHaveLength(1);

        const computerProvider = providers[0];
        const agent: Agent = { id: "test-agent", name: "test-agent" };

        await expect(computerProvider?.getAllTools(agent)).rejects.toThrow(
            "The Agent is not registered with this tool provider and thus the agent does not have a computer id"
        );
    });

    it("registerComputer returns ComputerProvider and registerToolProviders attaches it when passed", () => {
        const config: AgentConfig = {
            models: [],
            skillRepositories: [],
            toolProviders: [
                {
                    type: "computer",
                    provider: {
                        type: "local",
                        enableGUIToolsIfAvailable: false,
                    },
                },
            ],
        };

        const computer = registerComputer(config);
        expect(computer).toBeDefined();

        registerToolProviders(config, computer);
        const providers = toolProviderRegistry.getAllToolProviders();
        expect(providers).toHaveLength(1);
    });

    it("registerComputer returns undefined when no computer provider is configured", () => {
        const config: AgentConfig = {
            models: [],
            skillRepositories: [],
            toolProviders: [],
        };

        const computer = registerComputer(config);
        expect(computer).toBeUndefined();

        registerToolProviders(config, computer);
        const providers = toolProviderRegistry.getAllToolProviders();
        expect(providers).toHaveLength(0);
    });
});
