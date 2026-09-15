import { beforeEach, describe, expect, it } from "bun:test";
import {
    McpServerToolProvider,
    OpenAPIToolProvider,
    toolProviderRegistry,
} from "@byo-ai-agent-platform/core/tools";
import type { AgentConfig } from "./agent.config";
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
        expect(providers[0]).toBeInstanceOf(OpenAPIToolProvider);
    });

    it("registers mcp stdio tool provider from config", () => {
        const config: AgentConfig = {
            models: [],
            skillRepositories: [],
            toolProviders: [
                {
                    name: "my-mcp-stdio-service",
                    type: "mcp",
                    transport: "stdio",
                    command: "node",
                    args: ["server.js"],
                },
            ],
        };

        registerToolProviders(config);

        const providers = toolProviderRegistry.getAllToolProviders();
        expect(providers).toHaveLength(1);
        expect(providers[0]).toBeInstanceOf(McpServerToolProvider);
    });

    it("registers mcp http tool provider from config", () => {
        const config: AgentConfig = {
            models: [],
            skillRepositories: [],
            toolProviders: [
                {
                    name: "my-mcp-http-service",
                    type: "mcp",
                    transport: "http",
                    url: "http://localhost:3000/mcp",
                },
            ],
        };

        registerToolProviders(config);

        const providers = toolProviderRegistry.getAllToolProviders();
        expect(providers).toHaveLength(1);
        expect(providers[0]).toBeInstanceOf(McpServerToolProvider);
    });

    it("registers mcp computer tool provider from config when computer provider is configured", () => {
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
                {
                    name: "my-mcp-computer-service",
                    type: "mcp",
                    transport: "computer",
                    command: "python",
                    args: ["mcp_server.py"],
                },
            ],
        };

        const computer = registerComputer(config);
        registerToolProviders(config, computer);

        const providers = toolProviderRegistry.getAllToolProviders();
        expect(providers).toHaveLength(2);
        expect(providers[1]).toBeInstanceOf(McpServerToolProvider);
    });

    it("throws when registering mcp computer tool provider without computer provider", () => {
        const config: AgentConfig = {
            models: [],
            skillRepositories: [],
            toolProviders: [
                {
                    name: "my-mcp-computer-service",
                    type: "mcp",
                    transport: "computer",
                    command: "python",
                    args: ["mcp_server.py"],
                },
            ],
        };

        expect(() => registerToolProviders(config)).toThrow(
            "Cannot create the mcp tool provider my-mcp-computer-service. There is no computer provider added.",
        );
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
