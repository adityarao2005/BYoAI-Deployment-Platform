/**
 * Base domain exception for all BYoAI agent platform errors.
 */
export class BYoAIError extends Error {
    /**
     * Error code category identifier.
     */
    readonly code: string;
    /**
     * Additional structured metadata or context associated with the error.
     */
    readonly details?: Record<string, any>;
    /**
     * Underlying cause of the error if wrapped from another error.
     */
    override readonly cause?: unknown;

    constructor(
        message: string,
        code = "BYOAI_ERROR",
        details?: Record<string, any>,
        cause?: unknown,
    ) {
        super(message);
        this.name = this.constructor.name;
        this.code = code;
        this.details = details;
        this.cause = cause;

        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor);
        }
    }
}

/**
 * Thrown when an agent execution turn, lifecycle step, or communication fails.
 */
export class AgentExecutionError extends BYoAIError {
    constructor(
        message: string,
        details?: Record<string, any>,
        cause?: unknown,
    ) {
        super(message, "AGENT_EXECUTION_ERROR", details, cause);
    }
}

/**
 * Thrown when tool argument validation, discovery, or execution fails.
 */
export class ToolExecutionError extends BYoAIError {
    readonly toolName?: string;

    constructor(
        message: string,
        toolName?: string,
        details?: Record<string, any>,
        cause?: unknown,
    ) {
        super(
            message,
            "TOOL_EXECUTION_ERROR",
            { ...details, toolName },
            cause,
        );
        this.toolName = toolName;
    }
}

/**
 * Thrown when model execution, provider response parsing, or API calls fail.
 */
export class ModelProviderError extends BYoAIError {
    readonly modelName?: string;

    constructor(
        message: string,
        modelName?: string,
        details?: Record<string, any>,
        cause?: unknown,
    ) {
        super(
            message,
            "MODEL_PROVIDER_ERROR",
            { ...details, modelName },
            cause,
        );
        this.modelName = modelName;
    }
}

/**
 * Thrown when memory management, transcript retrieval, or agent persistence fails.
 */
export class MemoryError extends BYoAIError {
    constructor(
        message: string,
        details?: Record<string, any>,
        cause?: unknown,
    ) {
        super(message, "MEMORY_ERROR", details, cause);
    }
}

/**
 * Thrown when computer provider management, container operations, or remote computer RPC fails.
 */
export class ComputerProviderError extends BYoAIError {
    readonly computerId?: string;

    constructor(
        message: string,
        computerId?: string,
        details?: Record<string, any>,
        cause?: unknown,
    ) {
        super(
            message,
            "COMPUTER_PROVIDER_ERROR",
            { ...details, computerId },
            cause,
        );
        this.computerId = computerId;
    }
}

/**
 * Thrown when configuration loading, parsing, or schema validation fails.
 */
export class ConfigError extends BYoAIError {
    constructor(
        message: string,
        details?: Record<string, any>,
        cause?: unknown,
    ) {
        super(message, "CONFIG_ERROR", details, cause);
    }
}

/**
 * Thrown when skill repository cloning, downloading, unzipping, or indexing fails.
 */
export class SkillRepositoryError extends BYoAIError {
    constructor(
        message: string,
        details?: Record<string, any>,
        cause?: unknown,
    ) {
        super(message, "SKILL_REPOSITORY_ERROR", details, cause);
    }
}

/**
 * Thrown when schema or argument validation fails.
 */
export class ValidationError extends BYoAIError {
    constructor(
        message: string,
        details?: Record<string, any>,
        cause?: unknown,
    ) {
        super(message, "VALIDATION_ERROR", details, cause);
    }
}
