import { randomUUID } from "node:crypto";
import {
    type AgentCommunicator,
    type AgentEventHandler,
    type AgentEventMap,
    COMMAND_EVENTS,
    type DeliveryMode,
    type EmitOptions,
    type SubscriptionOptions,
    TELEMETRY_EVENTS,
} from "@byo-ai-agent-platform/core/agents";
import { type Consumer, Kafka, type Producer } from "kafkajs";

export interface KafkaConnectorProperties {
    brokers?: string[] | string;
    BROKERS?: string[] | string;
    bootstrapServers?: string[] | string;
    BOOTSTRAP_SERVERS?: string[] | string;
    clientId?: string;
    CLIENT_ID?: string;
    telemetryTopic?: string;
    TELEMETRY_TOPIC?: string;
    commandsTopic?: string;
    COMMANDS_TOPIC?: string;
    consumerGroup?: string;
    CONSUMER_GROUP?: string;
    instanceId?: string;
    INSTANCE_ID?: string;
    [key: string]: any;
}

export class KafkaAgentCommunicator implements AgentCommunicator {
    private readonly kafka: Kafka;
    private producer: Producer | null = null;
    private telemetryConsumer: Consumer | null = null;
    private workerConsumer: Consumer | null = null;

    public readonly brokers: string[];
    public readonly clientId: string;
    public readonly telemetryTopic: string;
    public readonly commandsTopic: string;
    public readonly consumerGroup: string;
    public readonly telemetryGroup: string;

    private readonly broadcastHandlers: Map<
        keyof AgentEventMap,
        Set<AgentEventHandler<any>>
    > = new Map();

    private readonly queueHandlers: Map<
        keyof AgentEventMap,
        Set<AgentEventHandler<any>>
    > = new Map();

    private isDestroyed = false;

    constructor(properties: KafkaConnectorProperties = {}) {
        const rawBrokers =
            properties.brokers ??
            properties.BROKERS ??
            properties.bootstrapServers ??
            properties.BOOTSTRAP_SERVERS ??
            "127.0.0.1:9092";

        this.brokers = Array.isArray(rawBrokers)
            ? rawBrokers
            : rawBrokers.split(",").map((s) => s.trim());

        this.clientId =
            properties.clientId ?? properties.CLIENT_ID ?? "agentic-harness";
        this.telemetryTopic =
            properties.telemetryTopic ??
            properties.TELEMETRY_TOPIC ??
            "agentic-telemetry";
        this.commandsTopic =
            properties.commandsTopic ??
            properties.COMMANDS_TOPIC ??
            "agentic-commands";
        this.consumerGroup =
            properties.consumerGroup ??
            properties.CONSUMER_GROUP ??
            "agentic-workers";

        const instanceId =
            properties.instanceId ??
            properties.INSTANCE_ID ??
            randomUUID().slice(0, 8);
        this.telemetryGroup = `agentic-telemetry-${instanceId}`;

        this.kafka = new Kafka({
            clientId: this.clientId,
            brokers: this.brokers,
        });
    }

    async init(): Promise<void> {
        this.isDestroyed = false;

        this.producer = this.kafka.producer();
        this.telemetryConsumer = this.kafka.consumer({
            groupId: this.telemetryGroup,
        });
        this.workerConsumer = this.kafka.consumer({
            groupId: this.consumerGroup,
        });

        await Promise.all([
            this.producer.connect(),
            this.telemetryConsumer.connect(),
            this.workerConsumer.connect(),
        ]);

        // 1. Subscribe to broadcast telemetry topic
        await this.telemetryConsumer.subscribe({
            topic: this.telemetryTopic,
            fromBeginning: false,
        });
        await this.telemetryConsumer.run({
            eachMessage: async ({ message }) => {
                if (this.isDestroyed || !message.value) return;
                try {
                    const parsed = JSON.parse(message.value.toString("utf8"));
                    const handlers = this.broadcastHandlers.get(parsed.event);
                    if (handlers) {
                        for (const handler of handlers) {
                            try {
                                const res = handler(parsed.payload);
                                if (res && typeof (res as Promise<any>).catch === "function") {
                                    (res as Promise<any>).catch(() => {});
                                }
                            } catch {
                                // Prevent handler crash
                            }
                        }
                    }
                } catch {
                    // Ignore malformed message
                }
            },
        });

        // 2. Subscribe to partitioned work queue topic
        await this.workerConsumer.subscribe({
            topic: this.commandsTopic,
            fromBeginning: false,
        });
        await this.workerConsumer.run({
            eachMessage: async ({ message }) => {
                if (this.isDestroyed || !message.value) return;
                try {
                    const parsed = JSON.parse(message.value.toString("utf8"));
                    const handlers = this.queueHandlers.get(parsed.event);
                    if (handlers && handlers.size > 0) {
                        await Promise.all(
                            Array.from(handlers).map(async (handler) => {
                                try {
                                    await handler(parsed.payload);
                                } catch {
                                    // Handle worker errors gracefully
                                }
                            }),
                        );
                    }
                } catch {
                    // Ignore malformed message
                }
            },
        });
    }

    private resolveDeliveryMode(
        event: keyof AgentEventMap,
        override?: DeliveryMode,
    ): DeliveryMode {
        if (override) return override;
        if (COMMAND_EVENTS.has(event)) return "queue";
        return "broadcast";
    }

    async emit<K extends keyof AgentEventMap>(
        event: K,
        payload: AgentEventMap[K],
        options?: EmitOptions,
    ): Promise<void> {
        if (!this.producer) {
            throw new Error(
                "KafkaAgentCommunicator is not connected. Call init() first.",
            );
        }

        const mode = this.resolveDeliveryMode(event, options?.delivery);
        const value = JSON.stringify({ event, payload });

        if (mode === "queue") {
            const partitionKey =
                options?.partitionKey ??
                (payload as any)?.agentId ??
                "default-key";

            await this.producer.send({
                topic: this.commandsTopic,
                messages: [{ key: String(partitionKey), value }],
            });
        } else {
            await this.producer.send({
                topic: this.telemetryTopic,
                messages: [{ value }],
            });
        }
    }

    on<K extends keyof AgentEventMap>(
        event: K,
        handler: AgentEventHandler<AgentEventMap[K]>,
        options?: SubscriptionOptions,
    ): () => void {
        const mode = this.resolveDeliveryMode(event, options?.delivery);

        if (mode === "queue") {
            let handlers = this.queueHandlers.get(event);
            if (!handlers) {
                handlers = new Set();
                this.queueHandlers.set(event, handlers);
            }
            handlers.add(handler);
            return () => {
                this.queueHandlers.get(event)?.delete(handler);
            };
        }

        let handlers = this.broadcastHandlers.get(event);
        if (!handlers) {
            handlers = new Set();
            this.broadcastHandlers.set(event, handlers);
        }
        handlers.add(handler);
        return () => {
            this.broadcastHandlers.get(event)?.delete(handler);
        };
    }

    async destroy(): Promise<void> {
        this.isDestroyed = true;
        this.broadcastHandlers.clear();
        this.queueHandlers.clear();

        try {
            await this.telemetryConsumer?.disconnect();
        } catch {}
        try {
            await this.workerConsumer?.disconnect();
        } catch {}
        try {
            await this.producer?.disconnect();
        } catch {}

        this.telemetryConsumer = null;
        this.workerConsumer = null;
        this.producer = null;
    }
}

export function createCommunicator(
    properties: KafkaConnectorProperties = {},
): KafkaAgentCommunicator {
    return new KafkaAgentCommunicator(properties);
}

export default KafkaAgentCommunicator;
