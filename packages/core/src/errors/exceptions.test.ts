import { describe, expect, it } from "bun:test";
import {
    BYoAIError,
    ComputerProviderError,
    ModelProviderError,
    ToolExecutionError,
} from "./exceptions";

describe("BYoAI Exceptions", () => {
    it("should instantiate base BYoAIError with code and details", () => {
        const causeErr = new Error("inner failure");
        const error = new BYoAIError("Base error", "CUSTOM_CODE", { key: "value" }, causeErr);

        expect(error).toBeInstanceOf(Error);
        expect(error).toBeInstanceOf(BYoAIError);
        expect(error.name).toBe("BYoAIError");
        expect(error.message).toBe("Base error");
        expect(error.code).toBe("CUSTOM_CODE");
        expect(error.details).toEqual({ key: "value" });
        expect(error.cause).toBe(causeErr);
    });

    it("should correctly handle ToolExecutionError with toolName", () => {
        const error = new ToolExecutionError("Tool execution failed", "run_bash");

        expect(error).toBeInstanceOf(BYoAIError);
        expect(error).toBeInstanceOf(ToolExecutionError);
        expect(error.code).toBe("TOOL_EXECUTION_ERROR");
        expect(error.toolName).toBe("run_bash");
        expect(error.details).toEqual({ toolName: "run_bash" });
    });

    it("should correctly handle ComputerProviderError and ModelProviderError", () => {
        const compErr = new ComputerProviderError("Container dead", "comp-123");
        expect(compErr.computerId).toBe("comp-123");
        expect(compErr.code).toBe("COMPUTER_PROVIDER_ERROR");

        const modelErr = new ModelProviderError("API limit", "gpt-4o");
        expect(modelErr.modelName).toBe("gpt-4o");
        expect(modelErr.code).toBe("MODEL_PROVIDER_ERROR");
    });
});
