import type { ModelMessageOutput } from "@/models";
import type { Agent } from "./agents";

/**
 * Strongly-typed event map for agent asynchronous communication and pub/sub messaging.
 */
export type AgentEventMap = {
    "user:message": { agent: Agent; content: string };
    "agent:message": { agent: Agent; content: string };
    "agent:run": { agent: Agent };
    "agent:complete": { agent: Agent };
    "tool:call": {
        agent: Agent;
        toolCallId: string;
        tool: string;
        args: Record<string, any>;
    };
    "tool:complete": {
        agent: Agent;
        toolCallId: string;
        tool: string;
        result: any;
    };
};

/** Handler callback type for agent events. */
export type AgentEventHandler<T> = (payload: T) => Promise<void> | void;

/**
 * Event-driven asynchronous pub/sub communicator interface for agents.
 */
export interface AgentCommunicator {
    /** Emits an event with payload to registered listeners */
    emit<K extends keyof AgentEventMap>(
        event: K,
        payload: AgentEventMap[K],
    ): Promise<void>;
    /** Registers an event listener function and returns an unsubscribe callback */
    on<K extends keyof AgentEventMap>(
        event: K,
        handler: AgentEventHandler<AgentEventMap[K]>,
    ): () => void;
}

/**
 * Observer interface for monitoring agent execution lifecycle events (model prompts, tool calls, turn start/end).
 */
export interface AgentObserver {
    onTurnStart?(agent: Agent, userMessage: string): Promise<void> | void;
    onTurnEnd?(agent: Agent, error?: unknown): Promise<void> | void;
    onModelStart?(agent: Agent, prompt: string): Promise<void> | void;
    onModelEnd?(
        agent: Agent,
        output: ModelMessageOutput[],
    ): Promise<void> | void;
    onAgentMessage?(agent: Agent, content: string): Promise<void> | void;
    onToolCallStart?(
        agent: Agent,
        toolCallId: string,
        tool: string,
        args: Record<string, any>,
    ): Promise<void> | void;
    onToolCallEnd?(
        agent: Agent,
        toolCallId: string,
        tool: string,
        result: any,
        error?: unknown,
    ): Promise<void> | void;
    onError?(
        agent: Agent,
        error: unknown,
        context?: string,
    ): Promise<void> | void;
}

