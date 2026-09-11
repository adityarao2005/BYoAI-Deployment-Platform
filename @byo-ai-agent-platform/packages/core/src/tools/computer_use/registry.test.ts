import { describe, expect, it } from "bun:test";
import { createComputerProvider, createComputerUseToolProvider } from "./registry";
import { LocalComputerProvider } from "@/computer/local_provider";
import { RemoteComputerProvider } from "@/computer/remote_provider";
import { ComputerUseToolProvider } from "./provider";

describe("createComputerProvider", () => {
    it("creates local computer provider", () => {
        const provider = createComputerProvider({
            type: "local",
            enableGUIToolsIfAvailable: false,
        });
        expect(provider).toBeInstanceOf(LocalComputerProvider);
    });

    it("creates remote computer provider", () => {
        const provider = createComputerProvider({
            type: "remote",
            url: "http://localhost:8080",
            image: "ubuntu:latest",
            enableGUIToolsIfAvailable: true,
            envFile: "",
        });
        expect(provider).toBeInstanceOf(RemoteComputerProvider);
    });

    it("creates computer provider from ComputerUseToolProviderConfig", () => {
        const provider = createComputerProvider({
            type: "computer",
            provider: {
                type: "local",
                enableGUIToolsIfAvailable: false,
            },
        });
        expect(provider).toBeInstanceOf(LocalComputerProvider);
    });

    it("throws on unknown computer provider type", () => {
        expect(() =>
            createComputerProvider({ type: "unknown" } as any)
        ).toThrow("Unknown computer provider type: unknown");
    });
});

describe("createComputerUseToolProvider", () => {
    it("creates ComputerUseToolProvider wrapping a local computer provider", () => {
        const toolProvider = createComputerUseToolProvider({
            type: "computer",
            provider: {
                type: "local",
                enableGUIToolsIfAvailable: false,
            },
        });
        expect(toolProvider).toBeInstanceOf(ComputerUseToolProvider);
    });

    it("creates ComputerUseToolProvider wrapping a remote computer provider", () => {
        const toolProvider = createComputerUseToolProvider({
            type: "computer",
            provider: {
                type: "remote",
                url: "http://localhost:8080",
                image: "ubuntu:latest",
                enableGUIToolsIfAvailable: true,
                envFile: "",
            },
        });
        expect(toolProvider).toBeInstanceOf(ComputerUseToolProvider);
    });
});
