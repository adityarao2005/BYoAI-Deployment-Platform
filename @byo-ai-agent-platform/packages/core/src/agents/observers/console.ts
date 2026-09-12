import type { Agent, AgentObserver } from "../agents";

export class ConsoleAgentObserver implements AgentObserver {
    onAgentMessage(_agent: Agent, content: string): void {
        console.log(`assistant: ${content}`);
    }

    onToolCallStart(
        _agent: Agent,
        _toolCallId: string,
        tool: string,
        args: Record<string, any>,
    ): void {
        console.log(
            `Tool call: ${tool} with arguments: ${JSON.stringify(args)}`,
        );
    }

    onToolCallEnd(
        _agent: Agent,
        _toolCallId: string,
        tool: string,
        result: any,
        error?: unknown,
    ): void {
        if (error) {
            console.log(
                `Tool error: ${tool} with error: ${error instanceof Error ? error.message : String(error)}`,
            );
        } else {
            console.log(
                `Tool response: ${tool} with result: ${JSON.stringify(result)}`,
            );
        }
    }

    onTurnEnd(_agent: Agent, error?: unknown): void {
        if (error) {
            const message =
                error instanceof Error ? error.message : String(error);
            console.error(`[Turn error]: ${message}`);
        }
    }

    onError(_agent: Agent, error: unknown, context?: string): void {
        const prefix = context ? `[Agent error (${context})]` : "[Agent error]";
        const message =
            error instanceof Error
                ? (error.stack ?? error.message)
                : String(error);
        console.error(`${prefix}: ${message}`);
    }
}
