import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Interaction } from "../types";
import { Sidebar } from "./Sidebar";

describe("Sidebar UI component", () => {
    it("renders interaction list items with titles and mode badges", () => {
        const interactions: Interaction[] = [
            {
                id: "int-1",
                title: "Code Refactoring",
                mode: "interactive",
                status: "idle",
                createdAt: "2026-10-04T10:00:00Z",
                updatedAt: "2026-10-04T10:30:00Z",
            },
            {
                id: "int-2",
                title: "Automated Build Run",
                mode: "non-interactive",
                status: "completed",
                createdAt: "2026-10-04T09:00:00Z",
                updatedAt: "2026-10-04T09:15:00Z",
            },
        ];

        const html = renderToStaticMarkup(
            <Sidebar
                interactions={interactions}
                selectedId="int-1"
                onSelect={() => {}}
                onNewChat={() => {}}
            />,
        );

        expect(html).toContain("New Interaction");
        expect(html).toContain("Code Refactoring");
        expect(html).toContain("interactive");
        expect(html).toContain("Automated Build Run");
        expect(html).toContain("non-interactive");
        // Active item should have indigo border styling
        expect(html).toContain("border-indigo-500/40");
    });

    it("renders empty state message when interaction list is empty", () => {
        const html = renderToStaticMarkup(
            <Sidebar
                interactions={[]}
                selectedId={null}
                onSelect={() => {}}
                onNewChat={() => {}}
            />,
        );

        expect(html).toContain("No interactions yet.");
        expect(html).toContain("Click &quot;New Interaction&quot; to begin.");
    });
});
