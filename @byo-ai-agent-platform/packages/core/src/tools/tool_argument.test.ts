import { describe, it, expect } from "vitest";
import { validateToolArgument, ToolArgument } from "./tool_argument"; // Adjust path to your file

describe("validateToolArgument", () => {
  // --- PRIMITIVES ---
  
  it("should validate strings and check enums", () => {
    const stringArg: ToolArgument = { type: "string", description: "a string" };
    expect(validateToolArgument(stringArg, "hello")).toBe(true);
    expect(validateToolArgument(stringArg, 123)).toBe(false);

    const enumArg: ToolArgument = { 
      type: "string", 
      description: "enum", 
      enum: ["celsius", "fahrenheit"] 
    };
    expect(validateToolArgument(enumArg, "celsius")).toBe(true);
    expect(validateToolArgument(enumArg, "kelvin")).toBe(false);
  });

  it("should validate integers strictly", () => {
    const intArg: ToolArgument = { type: "integer", description: "an int" };
    expect(validateToolArgument(intArg, 42)).toBe(true);
    expect(validateToolArgument(intArg, -10)).toBe(true);
    expect(validateToolArgument(intArg, 3.14)).toBe(false);
    expect(validateToolArgument(intArg, "42")).toBe(false);
  });

  it("should validate numbers and reject NaN/Infinity", () => {
    const numArg: ToolArgument = { type: "number", description: "a float/double" };
    expect(validateToolArgument(numArg, 3.14)).toBe(true);
    expect(validateToolArgument(numArg, 42)).toBe(true);
    expect(validateToolArgument(numArg, -0.005)).toBe(true);
    
    // Guard against JavaScript quirks
    expect(validateToolArgument(numArg, NaN)).toBe(false);
    expect(validateToolArgument(numArg, Infinity)).toBe(false);
    expect(validateToolArgument(numArg, -Infinity)).toBe(false);
    expect(validateToolArgument(numArg, "string number")).toBe(false);
  });

  it("should validate booleans", () => {
    const boolArg: ToolArgument = { type: "boolean", description: "a flag" };
    expect(validateToolArgument(boolArg, true)).toBe(true);
    expect(validateToolArgument(boolArg, false)).toBe(true);
    expect(validateToolArgument(boolArg, "true")).toBe(false);
    expect(validateToolArgument(boolArg, 1)).toBe(false);
  });

  // --- ARRAYS ---

  it("should validate arrays recursively", () => {
    const stringArrayArg: ToolArgument = {
      type: "array",
      description: "list of tags",
      items: { type: "string", description: "tag" }
    };
    expect(validateToolArgument(stringArrayArg, ["ai", "mcp", "ts"])).toBe(true);
    expect(validateToolArgument(stringArrayArg, ["ai", 123])).toBe(false); // bad item
    expect(validateToolArgument(stringArrayArg, "not an array")).toBe(false);
  });

  // --- OBJECTS ---

  describe("objects and nesting", () => {
    const userSchema: ToolArgument = {
      type: "object",
      description: "user profile",
      properties: {
        id: { type: "string", description: "user id" },
        age: { type: "integer", description: "user age" },
        score: { type: "number", description: "user score" }
      },
      required: ["id", "age"]
    };

    it("should pass a valid object matching the schema", () => {
      const validUser = { id: "user_101", age: 30, score: 98.5 };
      expect(validateToolArgument(userSchema, validUser)).toBe(true);
    });

    it("should allow omitting optional fields", () => {
      const missingOptional = { id: "user_101", age: 30 }; // 'score' omitted
      expect(validateToolArgument(userSchema, missingOptional)).toBe(true);
    });

    it("should fail if required fields are missing", () => {
      const missingRequired = { id: "user_101", score: 98.5 }; // 'age' missing
      expect(validateToolArgument(userSchema, missingRequired)).toBe(false);
    });

    it("should fail if nested property validation fails", () => {
      const badPropertyType = { id: "user_101", age: "thirty" }; // age should be integer
      expect(validateToolArgument(userSchema, badPropertyType)).toBe(false);
    });

    it("should handle additionalProperties restriction cleanly", () => {
      const strictSchema: ToolArgument = {
        type: "object",
        description: "strict obj",
        properties: { allowed: { type: "boolean", description: "flag" } },
        additionalProperties: false
      };

      expect(validateToolArgument(strictSchema, { allowed: true })).toBe(true);
      expect(validateToolArgument(strictSchema, { allowed: true, rogueKey: "hack" })).toBe(false);
    });

    it("should handle deeply nested arrays of objects", () => {
      const complexSchema: ToolArgument = {
        type: "object",
        description: "order payload",
        properties: {
          orderId: { type: "string", description: "id" },
          items: {
            type: "array",
            description: "items list",
            items: {
              type: "object",
              description: "item description",
              properties: {
                sku: { type: "string", description: "sku" },
                quantity: { type: "integer", description: "qty" }
              },
              required: ["sku", "quantity"]
            }
          }
        },
        required: ["orderId", "items"]
      };

      const validPayload = {
        orderId: "ord_555",
        items: [
          { sku: "SKU-A", quantity: 2 },
          { sku: "SKU-B", quantity: 1 }
        ]
      };

      const invalidPayload = {
        orderId: "ord_555",
        items: [
          { sku: "SKU-A", quantity: 2.5 } // Quantity cannot be a float!
        ]
      };

      expect(validateToolArgument(complexSchema, validPayload)).toBe(true);
      expect(validateToolArgument(complexSchema, invalidPayload)).toBe(false);
    });
  });
});