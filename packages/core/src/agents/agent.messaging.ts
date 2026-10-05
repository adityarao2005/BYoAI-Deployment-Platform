
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
        parentId?: string;
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
 * Delivery mode for agent events:
 * - "broadcast": Pub/Sub Fanout — every subscriber instance receives the event (e.g. SSE telemetry).
 * - "queue": Competing Consumers — exactly one instance in the worker pool receives the event (e.g. tool execution, turn processing).
 */
export type DeliveryMode = "broadcast" | "queue";

/**
 * Options for subscribing to agent events.
 */
export interface SubscriptionOptions {
    /**
     * Delivery mode:
     * - "broadcast": All instances receive this message (Pub/Sub fanout).
     * - "queue": Exactly one instance receives this message (Work Queue / Competing Consumer).
     * Defaults to the event's canonical mode if omitted.
     */
    delivery?: DeliveryMode;

    /**
     * Optional queue or consumer group override name.
     */
    queueGroup?: string;
}

/**
 * Options for emitting agent events.
 */
export interface EmitOptions {
    /**
     * Delivery mode override for emission.
     */
    delivery?: DeliveryMode;

    /**
     * Partition key for partitioned brokers (e.g. Kafka partition key, AMQP routing key).
     * Defaults to payload.agentId if present.
     */
    partitionKey?: string;
}

/** Events that represent work tasks to be processed by a single worker */
export const COMMAND_EVENTS: ReadonlySet<keyof AgentEventMap> = new Set([
    "user:message",
    "tool:accept",
    "tool:reject",
    "agent:run",
]);

/** Events that represent telemetry/state notifications to be broadcast to all instances */
export const TELEMETRY_EVENTS: ReadonlySet<keyof AgentEventMap> = new Set([
    "agent:message",
    "agent:complete",
    "agent:error",
    "tool:approval_required",
    "tool:call",
    "tool:complete",
    "subagent:start",
    "subagent:message",
    "subagent:complete",
    "subagent:error",
]);

/**
 * Event-driven asynchronous pub/sub and queue communicator interface for agents.
 */
export interface AgentCommunicator {
    /** Emits an event with payload to registered listeners */
    emit<K extends keyof AgentEventMap>(
        event: K,
        payload: AgentEventMap[K],
        options?: EmitOptions,
    ): Promise<void>;

    /** Registers an event listener function and returns an unsubscribe callback */
    on<K extends keyof AgentEventMap>(
        event: K,
        handler: AgentEventHandler<AgentEventMap[K]>,
        options?: SubscriptionOptions,
    ): () => void;

    /** Optional lifecycle hook called upon harness initialization */
    init?(): Promise<void>;

    /** Optional lifecycle hook called upon harness graceful shutdown */
    destroy?(): Promise<void> | void;
}
