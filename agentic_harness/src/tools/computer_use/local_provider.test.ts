import { describe, expect, it } from "vitest";
import { LocalComputerUseToolProvider } from "./local_provider";
import { LocalComputerUseToolProviderConfig } from "@/config/tool_config";

describe("LocalComputerUseToolProvider", () => {
    const localConfig: LocalComputerUseToolProviderConfig = {
        type: "local",
        enableGUIToolsIfAvailable: false,
    };

    it("returns empty tool list for local provider", async () => {
        const provider = new LocalComputerUseToolProvider(localConfig);
        const tools = await provider.getAllTools();
        expect(tools).toEqual([]);
    });

    it("returns null when searching for unknown tool", async () => {
        const provider = new LocalComputerUseToolProvider(localConfig);
        const tool = await provider.getToolByName("unknown_tool");
        expect(tool).toBeNull();
    });
});
