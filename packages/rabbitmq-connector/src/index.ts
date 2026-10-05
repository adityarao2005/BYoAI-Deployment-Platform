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
import amqp, { type Channel, type ChannelModel } from "amqplib";

export interface RabbitMQConnectorProperties {
    url?: string;
    URL?: string;
    host?: string;
    HOST?: string;
    hostname?: string;
    port?: string | number;
    PORT?: string | number;
    username?: string;
    password?: string;
    telemetryExchange?: string;
    TELEMETRY_EXCHANGE?: string;
    commandsQueue?: string;
    COMMANDS_QUEUE?: string;
    prefetch?: number | string;
    [key: string]: any;
}

export class RabbitMQAgentCommunicator implements AgentCommunicator {
    private connection: ChannelModel | null = null;
    private channel: Channel | null = null;

    public readonly connectionUrl: string;
    public readonly telemetryExchange: string;
    public readonly commandsQueue: string;
    public readonly prefetch: number;

    private readonly broadcastHandlers: Map<
        keyof AgentEventMap,
        Set<AgentEventHandler<any>>
    > = new Map();

    private readonly queueHandlers: Map<
        keyof AgentEventMap,
        Set<AgentEventHandler<any>>
    > = new Map();

    private isDestroyed = false;

    constructor(properties: RabbitMQConnectorProperties = {}) {
        this.connectionUrl =
            properties.url ??
            properties.URL ??
            `amqp://${properties.username ? `${properties.username}:${properties.password ?? ""}@` : ""}${properties.host ?? properties.hostname ?? properties.HOST ?? "127.0.0.1"}:${properties.port ?? properties.PORT ?? 5672}`;

        this.telemetryExchange =
            properties.telemetryExchange ??
            properties.TELEMETRY_EXCHANGE ??
            "agentic:telemetry";
        this.commandsQueue =
            properties.commandsQueue ??
            properties.COMMANDS_QUEUE ??
            "agentic:commands";
        this.prefetch = Number(properties.prefetch ?? 1);
    }

    async init(): Promise<void> {
        this.isDestroyed = false;

        this.connection = await amqp.connect(this.connectionUrl);
        this.channel = await this.connection.createChannel();

        await this.channel.prefetch(this.prefetch);

        // 1. Setup Broadcast Fanout Exchange
        await this.channel.assertExchange(this.telemetryExchange, "fanout", {
            durable: false,
        });

        // Unique exclusive queue per instance to receive broadcast telemetry
        const telemetryQueue = await this.channel.assertQueue("", {
            exclusive: true,
            autoDelete: true,
        });
        await this.channel.bindQueue(
            telemetryQueue.queue,
            this.telemetryExchange,
            "",
        );

        await this.channel.consume(
            telemetryQueue.queue,
            (msg) => {
                if (!msg || this.isDestroyed) return;
                try {
                    const parsed = JSON.parse(msg.content.toString("utf8"));
                    const handlers = this.broadcastHandlers.get(parsed.event);
                    if (handlers) {
                        for (const handler of handlers) {
                            try {
                                const res = handler(parsed.payload);
                                if (res && typeof (res as Promise<any>).catch === "function") {
                                    (res as Promise<any>).catch(() => {});
                                }
                            } catch {
                                // Handlers shouldn't crash consumer
                            }
                        }
                    }
                } catch {
                    // Ignore corrupted messages
                } finally {
                    try {
                        this.channel?.ack(msg);
                    } catch {}
                }
            },
            { noAck: false },
        );

        // 2. Setup Durable Work Queue for Commands
        await this.channel.assertQueue(this.commandsQueue, { durable: true });

        await this.channel.consume(
            this.commandsQueue,
            async (msg) => {
                if (!msg || this.isDestroyed) return;
                try {
                    const parsed = JSON.parse(msg.content.toString("utf8"));
                    const handlers = this.queueHandlers.get(parsed.event);
                    if (handlers && handlers.size > 0) {
                        await Promise.all(
                            Array.from(handlers).map(async (handler) => {
                                try {
                                    await handler(parsed.payload);
                                } catch {
                                    // Worker error shouldn't crash loop
                                }
                            }),
                        );
                    }
                } catch {
                    // Ignore corrupted messages
                } finally {
                    try {
                        this.channel?.ack(msg);
                    } catch {}
                }
            },
            { noAck: false },
        );
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
        if (!this.channel) {
            throw new Error(
                "RabbitMQAgentCommunicator is not connected. Call init() first.",
            );
        }

        const mode = this.resolveDeliveryMode(event, options?.delivery);
        const buffer = Buffer.from(JSON.stringify({ event, payload }));

        if (mode === "queue") {
            this.channel.sendToQueue(this.commandsQueue, buffer, {
                persistent: true,
            });
        } else {
            this.channel.publish(this.telemetryExchange, "", buffer);
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
            await this.channel?.close();
        } catch {}

        try {
            await this.connection?.close();
        } catch {}

        this.channel = null;
        this.connection = null;
    }
}

export function createCommunicator(
    properties: RabbitMQConnectorProperties = {},
): RabbitMQAgentCommunicator {
    return new RabbitMQAgentCommunicator(properties);
}

export default RabbitMQAgentCommunicator;
