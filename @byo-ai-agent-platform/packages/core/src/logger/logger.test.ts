import { beforeEach, describe, expect, it, mock } from "bun:test";
import { configureLogger, getLogger, type ILogger, resetLogger, setLogger } from "./logger";

describe("BYoAI Configurable Logger", () => {
    beforeEach(() => {
        resetLogger();
    });

    it("should retrieve a logger instance bound to a module name", () => {
        const logger = getLogger("TestModule");
        expect(logger).toBeDefined();
        expect(typeof logger.info).toBe("function");
        expect(typeof logger.error).toBe("function");
    });

    it("should allow reconfiguring logger settings dynamically", () => {
        const logger = configureLogger({
            level: "debug",
            format: "json",
            silent: true,
        });
        expect(logger).toBeDefined();
        expect(getLogger("SubModule")).toBeDefined();
    });

    it("should support replacing the core logger with a custom logger", () => {
        const customLogger: ILogger = {
            debug: mock(),
            info: mock(),
            warn: mock(),
            error: mock(),
            child: mock().mockImplementation(() => customLogger),
        };

        setLogger(customLogger);

        const logger = getLogger("CustomTest");
        logger.info("Hello world");
        expect(customLogger.info).toHaveBeenCalledWith("Hello world");
    });
});

