import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { UserProfile } from "../types";
import { Navbar } from "./Navbar";

describe("Navbar UI component", () => {
    it("renders branding, connection status, and authenticated user", () => {
        const user: UserProfile = {
            name: "Alice Developer",
            email: "alice@example.com",
            isAuthenticated: true,
        };

        const html = renderToStaticMarkup(<Navbar user={user} />);

        expect(html).toContain("BYoAI Agent Platform");
        expect(html).toContain("Chat UI");
        expect(html).toContain("Connected");
        expect(html).toContain("Alice Developer");
        expect(html).not.toContain("Sign In with OAuth");
    });

    it("renders Sign In with OAuth link when user is unauthenticated", () => {
        const user: UserProfile = {
            name: "",
            email: "",
            isAuthenticated: false,
        };

        const html = renderToStaticMarkup(<Navbar user={user} />);

        expect(html).toContain("Sign In with OAuth");
        expect(html).toContain("/auth/login");
    });
});
