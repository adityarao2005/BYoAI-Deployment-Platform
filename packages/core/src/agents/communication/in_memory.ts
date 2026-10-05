import type {
    AgentCommunicator,
    AgentEventHandler,
    AgentEventMap,
    EmitOptions,
    SubscriptionOptions,
} from "@/agents";

/**
 * In-memory implementation of {@link AgentCommunicator} providing synchronous pub/sub event dispatching and listener management.
 */
export class InMemoryAgentCommunicator implements AgentCommunicator {
    public listeners: Map<keyof AgentEventMap, Set<AgentEventHandler<any>>> =
        new Map();
    public emitted: Array<{
        event: keyof AgentEventMap;
        payload: any;
        options?: EmitOptions;
    }> = [];

    async emit<K extends keyof AgentEventMap>(
        event: K,
        payload: AgentEventMap[K],
        options?: EmitOptions,
    ): Promise<void> {
        this.emitted.push({ event, payload, options });
        const handlers = this.listeners.get(event);
        if (handlers) {
            await Promise.all(
                Array.from(handlers).map((handler) => handler(payload)),
            );
        }
    }

    on<K extends keyof AgentEventMap>(
        event: K,
        handler: AgentEventHandler<AgentEventMap[K]>,
        _options?: SubscriptionOptions,
    ): () => void {
        let handlerSet = this.listeners.get(event);
        if (!handlerSet) {
            handlerSet = new Set();
            this.listeners.set(event, handlerSet);
        }
        handlerSet.add(handler);
        return () => {
            this.listeners.get(event)?.delete(handler);
        };
    }

    async init(): Promise<void> {}

    async destroy(): Promise<void> {
        this.clear();
    }

    clear(): void {
        this.listeners.clear();
        this.emitted = [];
    }
}
