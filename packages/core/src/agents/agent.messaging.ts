
/**
 * Strongly-typed event map for agent asynchronous communication and pub/sub messaging.
 */
export type AgentEventMap = {
    "user:message": { agentId: string; content: string };
    "agent:message": { agentId: string; content: string };
    "agent:run": { agentId: string };
    "agent:complete": { agentId: string };
    "agent:error": { agentId: string; error: string; context?: string };
    "tool:call": {
        agentId: string;
        toolCallId: string;
        tool: string;
        args: Record<string, any>;
    };
    "tool:complete": {
        agentId: string;
        toolCallId: string;
        tool: string;
        result: any;
    };
    "tool:approval_required": {
        agentId: string;
        toolCallId: string;
        tool: string;
        args: Record<string, any>;
    };
    "tool:accept": {
        agentId: string;
        toolCallId: string;
    };
    "tool:reject": {
        agentId: string;
        toolCallId: string;
        reason?: string;
    };
    /** Emitted on the parent's communicator when a subagent is spawned */
    "subagent:start": {
        agentId: string;
        subAgentId: string;
        goal: string;
    };
    /** Emitted on the parent's communicator when a subagent produces a message */
    "subagent:message": {
        agentId: string;
        subAgentId: string;
        content: string;
    };
    /** Emitted on the parent's communicator when a subagent completes */
    "subagent:complete": {
        agentId: string;
        subAgentId: string;
        result: string;
    };
    /** Emitted on the parent's communicator when a subagent encounters an error */
    "subagent:error": {
        agentId: string;
        subAgentId: string;
        error: string;
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
