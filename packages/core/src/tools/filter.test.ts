import { describe, expect, it } from "bun:test";
import type { Tool, ToolProvider } from "./tools";
import { FilteredToolProvider, matchesPattern, withToolFilter } from "./filter";

describe("matchesPattern", () => {
    it("should match wildcard * to any string", () => {
        expect(matchesPattern("*", "anything")).toBe(true);
        expect(matchesPattern("*", "")).toBe(true);
    });

    it("should match exact string", () => {
        expect(matchesPattern("read_file", "read_file")).toBe(true);
        expect(matchesPattern("read_file", "write_file")).toBe(false);
    });

    it("should match wildcard prefix, suffix, and infix qualifiers", () => {
        expect(matchesPattern("read_*_file", "read_local_file")).toBe(true);
        expect(matchesPattern("read_*_file", "read__file")).toBe(true);
        expect(matchesPattern("read_*_file", "write_local_file")).toBe(false);

        expect(matchesPattern("get_*", "get_scratchpad")).toBe(true);
        expect(matchesPattern("get_*", "set_scratchpad")).toBe(false);

        expect(matchesPattern("*_tool", "custom_tool")).toBe(true);
        expect(matchesPattern("*_tool", "custom_tool_v2")).toBe(false);
    });

    it("should support ? character matching", () => {
        expect(matchesPattern("tool_?", "tool_1")).toBe(true);
        expect(matchesPattern("tool_?", "tool_12")).toBe(false);
    });
});

describe("FilteredToolProvider", () => {
    const mockTools: Tool[] = [
        {
            name: "read_file",
            description: "Read a file",
            inputSchema: { type: "object", description: "", properties: {} },
            execute: async () => "read",
        },
        {
            name: "write_file",
            description: "Write a file",
            inputSchema: { type: "object", description: "", properties: {} },
            execute: async () => "written",
        },
        {
            name: "delete_file",
            description: "Delete a file",
            inputSchema: { type: "object", description: "", properties: {} },
            execute: async () => "deleted",
        },
    ];

    const mockProvider: ToolProvider = {
        async getAllTools() {
            return [...mockTools];
        },
        async getToolByName(name: string) {
            return mockTools.find((t) => t.name === name) ?? null;
        },
    };

    it("should filter out rejected/disallowed tools", async () => {
        const filtered = new FilteredToolProvider(mockProvider, {
            disallowedTools: ["delete_*"],
        });

        const all = await filtered.getAllTools();
        expect(all.map((t) => t.name)).toEqual(["read_file", "write_file"]);

        expect(await filtered.getToolByName("delete_file")).toBeNull();
        expect(await filtered.getToolByName("read_file")).not.toBeNull();
    });

    it("should only keep allowed tools when allowedTools is specified", async () => {
        const filtered = new FilteredToolProvider(mockProvider, {
            allowedTools: ["read_*"],
        });

        const all = await filtered.getAllTools();
        expect(all.map((t) => t.name)).toEqual(["read_file"]);

        expect(await filtered.getToolByName("write_file")).toBeNull();
        expect(await filtered.getToolByName("read_file")).not.toBeNull();
    });

    it("should flag tools requiring user input", async () => {
        const filtered = new FilteredToolProvider(mockProvider, {
            userInputTools: ["write_*", "delete_*"],
        });

        const all = await filtered.getAllTools();
        const write = all.find((t) => t.name === "write_file");
        const read = all.find((t) => t.name === "read_file");

        expect(write?.requires_user_input).toBe(true);
        expect(read?.requires_user_input).toBe(false);

        const fetchedWrite = await filtered.getToolByName("write_file");
        expect(fetchedWrite?.requires_user_input).toBe(true);
    });

    it("should allow all tools by default when allowedTools is omitted", async () => {
        const filtered = new FilteredToolProvider(mockProvider, {
            userInputTools: ["write_*"],
        });

        const all = await filtered.getAllTools();
        expect(all.map((t) => t.name)).toEqual(["read_file", "write_file", "delete_file"]);
        expect(await filtered.getToolByName("delete_file")).not.toBeNull();
    });

    it("withToolFilter should return original provider when no filter options provided", () => {
        expect(withToolFilter(mockProvider)).toBe(mockProvider);
        expect(withToolFilter(mockProvider, {})).toBe(mockProvider);
    });
});
