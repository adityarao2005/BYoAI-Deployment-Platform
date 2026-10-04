import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatInput } from "./ChatInput";

describe("ChatInput UI component", () => {
    it("renders idle interactive input with default placeholder", () => {
        const html = renderToStaticMarkup(
            <ChatInput
                inputText=""
                isInputDisabled={false}
                isInteractive={true}
                isAgentRunning={false}
                onInputChange={() => {}}
                onSubmit={() => {}}
            />,
        );

        expect(html).toContain("Type a message to the agent...");
        expect(html).toContain("Press Enter to send message.");
        expect(html).toContain("Markdown Supported");
        // Button should be disabled when inputText is empty
        expect(html).toContain("disabled");
    });

    it("renders agent thinking state when agent is running", () => {
        const html = renderToStaticMarkup(
            <ChatInput
                inputText="Current query"
                isInputDisabled={true}
                isInteractive={true}
                isAgentRunning={true}
                onInputChange={() => {}}
                onSubmit={() => {}}
            />,
        );

        expect(html).toContain("Agent is thinking...");
        expect(html).toContain(
            "Execution in progress. Please wait for completion.",
        );
        expect(html).toContain("animate-spin");
        expect(html).toContain("disabled");
    });

    it("renders disabled state for non-interactive mode", () => {
        const html = renderToStaticMarkup(
            <ChatInput
                inputText=""
                isInputDisabled={true}
                isInteractive={false}
                isAgentRunning={false}
                onInputChange={() => {}}
                onSubmit={() => {}}
            />,
        );

        expect(html).toContain("Non-interactive mode: messaging disabled");
        expect(html).toContain("This session is read-only.");
        expect(html).toContain("disabled");
    });

    it("renders enabled submit button when inputText is non-empty and interactive", () => {
        const html = renderToStaticMarkup(
            <ChatInput
                inputText="Can you summarize the code?"
                isInputDisabled={false}
                isInteractive={true}
                isAgentRunning={false}
                onInputChange={() => {}}
                onSubmit={() => {}}
            />,
        );

        expect(html).toContain("Can you summarize the code?");
        expect(html).toContain("Send");
    });
});
