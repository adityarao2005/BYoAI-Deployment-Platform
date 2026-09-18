import type { AgentObserver } from "@/agents/agent.observer";
import type { ModelMessageOutput } from "@/models";
import { getLogger, type ILogger } from "@/logger";

/**
 * Built-in {@link AgentObserver} that outputs structured logs for all agent lifecycle events
 * using the BYoAI core {@link ILogger}.
 */
export class LoggingAgentObserver implements AgentObserver {
    private logger: ILogger;

    constructor(customLogger?: ILogger) {
        this.logger = customLogger ?? getLogger("AgentObserver");
    }

    onTurnStart(agentId: string, userMessage: string): void {
        this.logger.info("Agent turn started", {
            agentId,
            userMessage: userMessage.length > 200 ? `${userMessage.substring(0, 200)}...` : userMessage,
        });
    }

    onTurnEnd(agentId: string, error?: unknown): void {
        if (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error("Agent turn completed with error", {
                agentId,
                error: message,
            });
        } else {
            this.logger.info("Agent turn completed successfully", { agentId });
        }
    }

    onModelStart(agentId: string, _prompt: string): void {
        this.logger.debug("Executing LLM model request", { agentId });
    }

    onModelEnd(agentId: string, output: ModelMessageOutput[]): void {
        this.logger.debug("LLM model execution finished", {
            agentId,
            messageCount: output.length,
        });
    }

    onAgentMessage(agentId: string, content: string): void {
        this.logger.info("Assistant response generated", {
            agentId,
            content: content.length > 300 ? `${content.substring(0, 300)}...` : content,
        });
    }

    onToolCallStart(
        agentId: string,
        toolCallId: string,
        tool: string,
        args: Record<string, any>,
    ): void {
        this.logger.info(`Tool invocation started: ${tool}`, {
            agentId,
            toolCallId,
            tool,
            arguments: args,
        });
    }

    onToolCallEnd(
        agentId: string,
        toolCallId: string,
        tool: string,
        result: any,
        error?: unknown,
    ): void {
        if (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error(`Tool execution failed: ${tool}`, {
                agentId,
                toolCallId,
                tool,
                error: message,
            });
        } else {
            this.logger.info(`Tool execution succeeded: ${tool}`, {
                agentId,
                toolCallId,
                tool,
                resultSummary: typeof result === "object" ? "object" : String(result),
            });
        }
    }

    onError(agentId: string, error: unknown, context?: string): void {
        const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
        this.logger.error("Agent execution error caught", {
            agentId,
            context,
            error: message,
        });
    }
}
