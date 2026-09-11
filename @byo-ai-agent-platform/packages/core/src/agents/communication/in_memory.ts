import type {
    AgentCommunicator,
    AgentEventMap,
    AgentEventHandler,
} from "../agents";

export class InMemoryAgentCommunicator implements AgentCommunicator {
    public listeners: Map<keyof AgentEventMap, Set<AgentEventHandler<any>>> = new Map();
    public emitted: Array<{ event: keyof AgentEventMap; payload: any }> = [];

    async emit<K extends keyof AgentEventMap>(event: K, payload: AgentEventMap[K]): Promise<void> {
        this.emitted.push({ event, payload });
        const handlers = this.listeners.get(event);
        if (handlers) {
            for (const handler of handlers) {
                await handler(payload);
            }
        }
    }

    on<K extends keyof AgentEventMap>(event: K, handler: AgentEventHandler<AgentEventMap[K]>): () => void {
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

    clear(): void {
        this.listeners.clear();
        this.emitted = [];
    }
}
