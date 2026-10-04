import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { SubAgentTask } from "../../types";
import { SubAgentAccordion } from "./SubAgentAccordion";

describe("SubAgentAccordion UI component", () => {
    it("renders running subagent with goal, id, and status", () => {
        const task: SubAgentTask = {
            id: "sa-test-1",
            parentId: "parent-root",
            goal: "Scan codebase for security vulnerabilities",
            status: "running",
            messages: ["Scanning packages...", "Checking dependencies..."],
            subagents: [],
            startedAt: "2026-10-04T12:00:00Z",
        };

        const html = renderToStaticMarkup(<SubAgentAccordion task={task} />);

        expect(html).toContain(
            "Subagent: Scan codebase for security vulnerabilities",
        );
        expect(html).toContain("ID: sa-test-1");
        expect(html).toContain("Running");
        expect(html).toContain("Scanning packages...");
        expect(html).toContain("Checking dependencies...");
    });

    it("renders completed subagent with final result", () => {
        const task: SubAgentTask = {
            id: "sa-test-2",
            parentId: "parent-root",
            goal: "Run unit tests",
            status: "completed",
            messages: ["Running bun test"],
            subagents: [],
            result: "All 54 tests passed successfully with 100% coverage.",
            startedAt: "2026-10-04T12:00:00Z",
        };

        const html = renderToStaticMarkup(<SubAgentAccordion task={task} />);

        expect(html).toContain("Completed");
        expect(html).toContain("Final Result:");
        expect(html).toContain(
            "All 54 tests passed successfully with 100% coverage.",
        );
    });

    it("renders failed subagent with error message", () => {
        const task: SubAgentTask = {
            id: "sa-test-3",
            parentId: "parent-root",
            goal: "Connect to database server",
            status: "error",
            messages: ["Connecting to port 5432..."],
            subagents: [],
            error: "Connection refused: database server unreachable",
            startedAt: "2026-10-04T12:00:00Z",
        };

        const html = renderToStaticMarkup(<SubAgentAccordion task={task} />);

        expect(html).toContain("Error");
        expect(html).toContain(
            "Connection refused: database server unreachable",
        );
    });

    it("renders recursive nested subagents and displays depth badge", () => {
        const childTask: SubAgentTask = {
            id: "sa-child-1",
            parentId: "sa-parent-1",
            goal: "Inspect AST of file A",
            status: "completed",
            messages: ["AST parsed"],
            subagents: [],
            result: "Syntax valid",
            startedAt: "2026-10-04T12:01:00Z",
        };

        const parentTask: SubAgentTask = {
            id: "sa-parent-1",
            parentId: "root",
            goal: "Parallel static analysis",
            status: "running",
            messages: ["Delegated file A to worker 1"],
            subagents: [childTask],
            startedAt: "2026-10-04T12:00:00Z",
        };

        const html = renderToStaticMarkup(
            <SubAgentAccordion task={parentTask} />,
        );

        expect(html).toContain("Parallel static analysis");
        expect(html).toContain("Nested Subagents (1):");
        expect(html).toContain("Inspect AST of file A");
        expect(html).toContain("depth 1");
        expect(html).toContain("Syntax valid");
    });
});
