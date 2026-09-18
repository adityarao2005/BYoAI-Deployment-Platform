import winston from "winston";

/**
 * Standard log severity levels supported by the BYoAI logger.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * Interface definition for BYoAI loggers.
 */
export interface ILogger {
    debug(message: string, ...meta: any[]): void;
    info(message: string, ...meta: any[]): void;
    warn(message: string, ...meta: any[]): void;
    error(message: string, ...meta: any[]): void;
    child?(defaultMeta: Record<string, any>): ILogger;
}

/**
 * Configuration options for adjusting the built-in Winston logger.
 */
export interface LoggerConfig {
    /** Minimum logging level to emit. Default is "info" or process.env.LOG_LEVEL */
    level?: LogLevel;
    /** Output formatting: "pretty" for colored human-readable logs, "json" for structured logs. Default is "pretty". */
    format?: "pretty" | "json";
    /** Optional file path to append logs to. */
    filePath?: string;
    /** Silence all output (useful in unit tests). */
    silent?: boolean;
    /** Custom Winston transports if advanced integration is desired. */
    transports?: winston.transport[];
}

class WinstonLoggerWrapper implements ILogger {
    private logger: winston.Logger;

    constructor(logger: winston.Logger) {
        this.logger = logger;
    }

    private extractMeta(args: any[]): { metaObject: Record<string, any> | null; formattedMessageExtra: string } {
        if (args.length === 0) return { metaObject: null, formattedMessageExtra: "" };
        if (args.length === 1 && typeof args[0] === "object" && args[0] !== null) {
            return { metaObject: args[0], formattedMessageExtra: "" };
        }
        return { metaObject: null, formattedMessageExtra: ` ${args.map(a => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ")}` };
    }

    debug(message: string, ...meta: any[]): void {
        const { metaObject, formattedMessageExtra } = this.extractMeta(meta);
        if (metaObject) {
            this.logger.debug(message, metaObject);
        } else {
            this.logger.debug(message + formattedMessageExtra);
        }
    }

    info(message: string, ...meta: any[]): void {
        const { metaObject, formattedMessageExtra } = this.extractMeta(meta);
        if (metaObject) {
            this.logger.info(message, metaObject);
        } else {
            this.logger.info(message + formattedMessageExtra);
        }
    }

    warn(message: string, ...meta: any[]): void {
        const { metaObject, formattedMessageExtra } = this.extractMeta(meta);
        if (metaObject) {
            this.logger.warn(message, metaObject);
        } else {
            this.logger.warn(message + formattedMessageExtra);
        }
    }

    error(message: string, ...meta: any[]): void {
        const { metaObject, formattedMessageExtra } = this.extractMeta(meta);
        if (metaObject) {
            this.logger.error(message, metaObject);
        } else {
            this.logger.error(message + formattedMessageExtra);
        }
    }

    child(defaultMeta: Record<string, any>): ILogger {
        return new WinstonLoggerWrapper(this.logger.child(defaultMeta));
    }
}

function createWinstonLogger(config: LoggerConfig): winston.Logger {
    const level = config.level ?? (process.env.LOG_LEVEL as LogLevel) ?? "info";
    const formatType = config.format ?? (process.env.LOG_FORMAT as "pretty" | "json") ?? "pretty";

    const customFormat = winston.format.printf(({ level, message, timestamp, module, ...metadata }) => {
        const modulePrefix = module ? `[${module}] ` : "";
        const metaStr = Object.keys(metadata).length ? ` ${JSON.stringify(metadata)}` : "";
        return `${timestamp} ${level.toUpperCase()} ${modulePrefix}${message}${metaStr}`;
    });

    const format = formatType === "json"
        ? winston.format.combine(
            winston.format.timestamp(),
            winston.format.json(),
        )
        : winston.format.combine(
            winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
            winston.format.colorize(),
            customFormat,
        );

    const transports: winston.transport[] = config.transports ?? [
        new winston.transports.Console({
            silent: config.silent,
        }),
    ];

    if (config.filePath) {
        transports.push(
            new winston.transports.File({
                filename: config.filePath,
                format: winston.format.combine(
                    winston.format.timestamp(),
                    winston.format.json(),
                ),
            }),
        );
    }

    return winston.createLogger({
        level,
        format,
        transports,
        silent: config.silent,
    });
}

let activeConfig: LoggerConfig = {
    level: (process.env.LOG_LEVEL as LogLevel) ?? "info",
    format: (process.env.LOG_FORMAT as "pretty" | "json") ?? "pretty",
    silent: process.env.NODE_ENV === "test" && !process.env.VERBOSE_LOGS,
};

let currentWinstonInstance = createWinstonLogger(activeConfig);
let currentLogger: ILogger = new WinstonLoggerWrapper(currentWinstonInstance);

/**
 * Reconfigures the global default Winston logger settings.
 *
 * @param config - New {@link LoggerConfig} options.
 * @returns Configured {@link ILogger} instance.
 */
export function configureLogger(config: LoggerConfig): ILogger {
    activeConfig = { ...activeConfig, ...config };
    currentWinstonInstance = createWinstonLogger(activeConfig);
    currentLogger = new WinstonLoggerWrapper(currentWinstonInstance);
    return currentLogger;
}

/**
 * Replaces the core logger with a custom user-provided logger implementation (e.g. Pino or custom Winston instance).
 *
 * @param customLogger - Instance satisfying {@link ILogger}.
 */
export function setLogger(customLogger: ILogger): void {
    currentLogger = customLogger;
}

/**
 * Obtains a logger instance bound to a module name context.
 *
 * @param moduleName - Optional component or module name label (e.g. "AgentManager", "RemoteComputerProvider").
 * @returns {@link ILogger} instance.
 */
export function getLogger(moduleName?: string): ILogger {
    if (moduleName && currentLogger.child) {
        return currentLogger.child({ module: moduleName });
    }
    return currentLogger;
}

/**
 * Resets logger to default settings (primarily used in tests).
 */
export function resetLogger(): void {
    activeConfig = {
        level: (process.env.LOG_LEVEL as LogLevel) ?? "info",
        format: (process.env.LOG_FORMAT as "pretty" | "json") ?? "pretty",
        silent: process.env.NODE_ENV === "test" && !process.env.VERBOSE_LOGS,
    };
    currentWinstonInstance = createWinstonLogger(activeConfig);
    currentLogger = new WinstonLoggerWrapper(currentWinstonInstance);
}
