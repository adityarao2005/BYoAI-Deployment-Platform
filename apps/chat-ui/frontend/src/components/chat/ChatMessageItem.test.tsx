import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ChatMessage } from "../../types";
import { ChatMessageItem } from "./ChatMessageItem";

describe("ChatMessageItem UI component", () => {
    it("renders user message with U badge and styling", () => {
        const message: ChatMessage = {
            id: "msg-user-1",
            role: "user",
            content: "Hello agent, please review this PR.",
            timestamp: "2026-10-04T12:00:00Z",
        };

        const html = renderToStaticMarkup(
            <ChatMessageItem message={message} />,
        );

        expect(html).toContain("Hello agent, please review this PR.");
        expect(html).toContain("U");
        expect(html).toContain("bg-indigo-600");
    });

    it("renders assistant message with AI badge and styling", () => {
        const message: ChatMessage = {
            id: "msg-ai-1",
            role: "assistant",
            content: "I have analyzed the pull request and found no issues.",
            timestamp: "2026-10-04T12:01:00Z",
        };

        const html = renderToStaticMarkup(
            <ChatMessageItem message={message} />,
        );

        expect(html).toContain(
            "I have analyzed the pull request and found no issues.",
        );
        expect(html).toContain("AI");
        expect(html).toContain("bg-slate-900");
    });

    it("renders error message with Harness Error alert", () => {
        const message: ChatMessage = {
            id: "msg-err-1",
            role: "error",
            content: "Model API rate limit exceeded.",
            timestamp: "2026-10-04T12:02:00Z",
            isError: true,
        };

        const html = renderToStaticMarkup(
            <ChatMessageItem message={message} />,
        );

        expect(html).toContain("Harness Error");
        expect(html).toContain("Model API rate limit exceeded.");
        expect(html).toContain("bg-rose-950");
    });

    it("delegates tool role to ToolCallMessage", () => {
        const message: ChatMessage = {
            id: "msg-tool-1",
            role: "tool",
            content: "",
            timestamp: "2026-10-04T12:03:00Z",
            toolCall: {
                id: "call-xyz",
                name: "file_writer",
                args: { path: "README.md" },
            },
        };

        const html = renderToStaticMarkup(
            <ChatMessageItem message={message} />,
        );

        expect(html).toContain("file_writer");
        expect(html).toContain("README.md");
    });

    it("delegates subagent role to SubAgentAccordion", () => {
        const message: ChatMessage = {
            id: "msg-sub-1",
            role: "subagent",
            content: "",
            timestamp: "2026-10-04T12:04:00Z",
            subagent: {
                id: "sub-task-1",
                parentId: "main-agent",
                goal: "Search codebase for API definitions",
                status: "running",
                messages: ["Scanning packages/core"],
                subagents: [],
                startedAt: "2026-10-04T12:04:00Z",
            },
        };

        const html = renderToStaticMarkup(
            <ChatMessageItem message={message} />,
        );

        expect(html).toContain("Search codebase for API definitions");
        expect(html).toContain("Scanning packages/core");
        expect(html).toContain("Running");
    });
});
