import { describe, expect, it } from "vitest";
import { registerComputerUseToolProvider } from "./registry";
import { toolProviderRegistry } from "../tools";

describe("registerComputerUseToolProvider", () => {
    it("registers remote computer tool provider into registry", () => {
        const initialCount = toolProviderRegistry.getAllToolProviders().length;

        registerComputerUseToolProvider([
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
        ]);

        const providers = toolProviderRegistry.getAllToolProviders();
        expect(providers.length).toBe(initialCount + 1);
    });

    it("registers local computer tool provider into registry", () => {
        const initialCount = toolProviderRegistry.getAllToolProviders().length;

        registerComputerUseToolProvider([
            {
                type: "computer",
                provider: {
                    type: "local",
                    enableGUIToolsIfAvailable: false,
                },
            },
        ]);

        const providers = toolProviderRegistry.getAllToolProviders();
        expect(providers.length).toBe(initialCount + 1);
    });

    it("throws if more than 1 computer tool provider is provided", () => {
        expect(() =>
            registerComputerUseToolProvider([
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
            ])
        ).toThrow("There should only be 1 computer use tool provider declared");
    });
});
