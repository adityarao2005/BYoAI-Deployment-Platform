import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ChatMessage, Interaction } from "../types";
import { ChatView } from "./ChatView";

describe("ChatView UI component", () => {
    const mockInteraction: Interaction = {
        id: "int-session-42",
        title: "Deployment Assistance",
        mode: "interactive",
        status: "idle",
        createdAt: "2026-10-04T12:00:00Z",
        updatedAt: "2026-10-04T12:05:00Z",
    };

    it("renders EmptyChatState when no interaction is selected", () => {
        const html = renderToStaticMarkup(
            <ChatView
                interaction={null}
                messages={[]}
                isAgentRunning={false}
                onSendMessage={() => {}}
            />,
        );

        expect(html).toContain("You have no chats yet");
        expect(html).toContain("Create New Chat");
    });

    it("renders interaction header and empty messages placeholder", () => {
        const html = renderToStaticMarkup(
            <ChatView
                interaction={mockInteraction}
                messages={[]}
                isAgentRunning={false}
                onSendMessage={() => {}}
            />,
        );

        expect(html).toContain("Deployment Assistance");
        expect(html).toContain("No messages in this interaction yet.");
        expect(html).toContain("Send a prompt below to begin the session.");
        expect(html).toContain("Type a message to the agent...");
    });

    it("renders chat messages and live running indicator", () => {
        const messages: ChatMessage[] = [
            {
                id: "m-1",
                role: "user",
                content: "Deploy version 1.2 to production",
                timestamp: "2026-10-04T12:01:00Z",
            },
            {
                id: "m-2",
                role: "assistant",
                content: "Starting production deployment pipeline...",
                timestamp: "2026-10-04T12:01:30Z",
            },
        ];

        const html = renderToStaticMarkup(
            <ChatView
                interaction={mockInteraction}
                messages={messages}
                isAgentRunning={true}
                onSendMessage={() => {}}
            />,
        );

        expect(html).toContain("Deploy version 1.2 to production");
        expect(html).toContain("Starting production deployment pipeline...");
        expect(html).toContain("Agent is executing...");
    });

    it("renders error banner when errorMessage is present", () => {
        const html = renderToStaticMarkup(
            <ChatView
                interaction={mockInteraction}
                messages={[]}
                isAgentRunning={false}
                errorMessage="Failed to establish SSE stream connection"
                onSendMessage={() => {}}
            />,
        );

        expect(html).toContain("Failed to establish SSE stream connection");
    });
});
