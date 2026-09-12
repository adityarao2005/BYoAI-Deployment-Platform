import { describe, expect, it } from "bun:test";
import { normalizeGeminiFunctionResponse } from "./gemini";

describe("normalizeGeminiFunctionResponse", () => {
    it("wraps scalar tool results in an object for Gemini", () => {
        expect(normalizeGeminiFunctionResponse("The weather is sunny."))
            .toEqual({ result: "The weather is sunny." });
    });

    it("preserves object-shaped tool results", () => {
        expect(normalizeGeminiFunctionResponse({ temperature: 25, condition: "sunny" }))
            .toEqual({ temperature: 25, condition: "sunny" });
    });

    it("maps undefined tool results to a Struct-safe null payload", () => {
        expect(normalizeGeminiFunctionResponse(undefined))
            .toEqual({ result: null });
    });
});