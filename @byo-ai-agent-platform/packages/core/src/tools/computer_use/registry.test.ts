import { describe, expect, it } from "bun:test";
import { createComputerUseToolProvider } from "./registry";
import { LocalComputerUseToolProvider } from "./local_provider";
import { RemoteComputerUseToolProvider } from "./remote_provider";

describe("createComputerUseToolProvider", () => {
    it("returns null if no computer tool provider is configured", () => {
        const provider = createComputerUseToolProvider([]);
        expect(provider).toBeNull();
    });

    it("creates remote computer tool provider", () => {
        const provider = createComputerUseToolProvider([
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

        expect(provider).toBeInstanceOf(RemoteComputerUseToolProvider);
    });

    it("creates local computer tool provider", () => {
        const provider = createComputerUseToolProvider([
            {
                type: "computer",
                provider: {
                    type: "local",
                    enableGUIToolsIfAvailable: false,
                },
            },
        ]);

        expect(provider).toBeInstanceOf(LocalComputerUseToolProvider);
    });

    it("throws if more than 1 computer tool provider is provided", () => {
        expect(() =>
            createComputerUseToolProvider([
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
