import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ChatMessage } from "../../types";
import { ToolCallMessage } from "./ToolCallMessage";

describe("ToolCallMessage UI component", () => {
    it("renders tool name and arguments", () => {
        const message: ChatMessage = {
            id: "msg-tool-1",
            role: "tool",
            content: "",
            timestamp: "2026-10-04T12:00:00Z",
            toolCall: {
                id: "call-1",
                name: "bash_exec",
                args: { command: "ls -la", timeout: 30 },
            },
        };

        const html = renderToStaticMarkup(
            <ToolCallMessage message={message} />,
        );

        expect(html).toContain("bash_exec");
        expect(html).toContain("Arguments:");
        expect(html).toContain("ls -la");
        expect(html).toContain("timeout");
    });

    it("renders approval banner and buttons when confirmation is required", () => {
        const message: ChatMessage = {
            id: "msg-tool-2",
            role: "tool",
            content: "",
            timestamp: "2026-10-04T12:00:00Z",
            toolCall: {
                id: "call-2",
                name: "delete_database",
                requires_user_input: true,
                decision: "pending",
                args: { force: true },
            },
        };

        const html = renderToStaticMarkup(
            <ToolCallMessage message={message} />,
        );

        expect(html).toContain("Approval Required");
        expect(html).toContain("User confirmation required");
        expect(html).toContain(
            "This tool requires approval before execution. Do you permit this action?",
        );
        expect(html).toContain("Accept");
        expect(html).toContain("Reject");
    });

    it("renders Approved status badge when accepted", () => {
        const message: ChatMessage = {
            id: "msg-tool-3",
            role: "tool",
            content: "",
            timestamp: "2026-10-04T12:00:00Z",
            toolCall: {
                id: "call-3",
                name: "deploy_service",
                requires_user_input: true,
                decision: "accepted",
                result: "Deployment initiated successfully",
            },
        };

        const html = renderToStaticMarkup(
            <ToolCallMessage message={message} />,
        );

        expect(html).toContain("Approved");
        expect(html).not.toContain("Approval Required");
        expect(html).not.toContain("User confirmation required");
        expect(html).toContain("Deployment initiated successfully");
    });

    it("renders Rejected status badge when decision is rejected", () => {
        const message: ChatMessage = {
            id: "msg-tool-4",
            role: "tool",
            content: "",
            timestamp: "2026-10-04T12:00:00Z",
            toolCall: {
                id: "call-4",
                name: "drop_table",
                requires_user_input: true,
                decision: "rejected",
            },
        };

        const html = renderToStaticMarkup(
            <ToolCallMessage message={message} />,
        );

        expect(html).toContain("Rejected");
        expect(html).not.toContain("Accept");
    });

    it("renders structured object results formatted as JSON", () => {
        const message: ChatMessage = {
            id: "msg-tool-5",
            role: "tool",
            content: "",
            timestamp: "2026-10-04T12:00:00Z",
            toolCall: {
                id: "call-5",
                name: "query_metrics",
                result: { cpu_usage: "12%", memory_mb: 512, healthy: true },
            },
        };

        const html = renderToStaticMarkup(
            <ToolCallMessage message={message} />,
        );

        expect(html).toContain("Result:");
        expect(html).toContain("cpu_usage");
        expect(html).toContain("memory_mb");
    });
});
