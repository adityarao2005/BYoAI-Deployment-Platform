import { createLogger, format, transports } from "winston";

export const logger = createLogger({
    level: "info",
    defaultMeta: { service: "agentic-harness" },
    format: format.simple(),
    transports: [
        new transports.Console({
            format: format.combine(
                format.colorize(),
                format.simple()
            )
        })
    ]
})