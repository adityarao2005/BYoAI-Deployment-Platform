import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { EmptyChatState } from "./EmptyChatState";

describe("EmptyChatState UI component", () => {
    it("renders empty state header, description, and action button", () => {
        const html = renderToStaticMarkup(<EmptyChatState />);

        expect(html).toContain("You have no chats yet");
        expect(html).toContain(
            "Create a new chat session to begin interacting with the AI agent.",
        );
        expect(html).toContain("Create New Chat");
    });
});
