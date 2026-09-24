import type { ModelMessageOutput } from "@/models";

/**
 * Observer interface for monitoring agent execution lifecycle events (model prompts, tool calls, turn start/end).
 */
export interface AgentObserver {
    onTurnStart?(agentId: string, userMessage: string): Promise<void> | void;
    onTurnEnd?(agentId: string, error?: unknown): Promise<void> | void;
    onModelStart?(agentId: string, prompt: string): Promise<void> | void;
    onModelEnd?(
        agentId: string,
        output: ModelMessageOutput[],
    ): Promise<void> | void;
    onAgentMessage?(agentId: string, content: string): Promise<void> | void;
    onToolCallStart?(
        agentId: string,
        toolCallId: string,
        tool: string,
        args: Record<string, any>,
    ): Promise<void> | void;
    onToolCallEnd?(
        agentId: string,
        toolCallId: string,
        tool: string,
        result: any,
        error?: unknown,
    ): Promise<void> | void;
    onError?(
        agentId: string,
        error: unknown,
        context?: string,
    ): Promise<void> | void;
}
