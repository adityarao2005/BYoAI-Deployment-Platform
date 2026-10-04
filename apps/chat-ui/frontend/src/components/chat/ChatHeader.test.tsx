import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Interaction } from "../../types";
import { ChatHeader } from "./ChatHeader";

describe("ChatHeader UI component", () => {
    const baseInteraction: Interaction = {
        id: "int-12345",
        title: "Test Session Alpha",
        mode: "interactive",
        status: "idle",
        createdAt: "2026-10-04T12:00:00Z",
        updatedAt: "2026-10-04T12:05:00Z",
    };

    it("renders interaction title and ID", () => {
        const html = renderToStaticMarkup(
            <ChatHeader interaction={baseInteraction} />,
        );

        expect(html).toContain("Test Session Alpha");
        expect(html).toContain("ID: int-12345");
    });

    it("falls back to default title when title is empty", () => {
        const interaction: Interaction = {
            ...baseInteraction,
            id: "fallback-id-99",
            title: "",
        };

        const html = renderToStaticMarkup(
            <ChatHeader interaction={interaction} />,
        );

        expect(html).toContain("Interaction fallback-id-99");
        expect(html).toContain("ID: fallback-id-99");
    });

    it("renders Interactive Mode badge when mode is interactive", () => {
        const html = renderToStaticMarkup(
            <ChatHeader
                interaction={{ ...baseInteraction, mode: "interactive" }}
            />,
        );

        expect(html).toContain("Interactive Mode");
        expect(html).not.toContain("Non-Interactive (Read-Only)");
    });

    it("renders Non-Interactive badge when mode is non-interactive", () => {
        const html = renderToStaticMarkup(
            <ChatHeader
                interaction={{
                    ...baseInteraction,
                    mode: "non-interactive",
                }}
            />,
        );

        expect(html).toContain("Non-Interactive (Read-Only)");
        expect(html).not.toContain("Interactive Mode");
    });
});
