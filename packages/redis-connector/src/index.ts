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
import { Redis, type RedisOptions } from "ioredis";

export interface RedisConnectorProperties {
    url?: string;
    URL?: string;
    host?: string;
    HOST?: string;
    port?: string | number;
    PORT?: string | number;
    password?: string;
    PASSWORD?: string;
    db?: string | number;
    DB?: string | number;
    telemetryTopic?: string;
    TELEMETRY_TOPIC?: string;
    commandsStream?: string;
    COMMANDS_STREAM?: string;
    consumerGroup?: string;
    CONSUMER_GROUP?: string;
    consumerName?: string;
    CONSUMER_NAME?: string;
    [key: string]: any;
}

export class RedisAgentCommunicator implements AgentCommunicator {
    private readonly publisher: Redis;
    private readonly subscriber: Redis;
    private readonly workerClient: Redis;

    public readonly telemetryTopic: string;
    public readonly commandsStream: string;
    public readonly consumerGroup: string;
    public readonly consumerName: string;

    private readonly broadcastHandlers: Map<
        keyof AgentEventMap,
        Set<AgentEventHandler<any>>
    > = new Map();

    private readonly queueHandlers: Map<
        keyof AgentEventMap,
        Set<AgentEventHandler<any>>
    > = new Map();

    private isDestroyed = false;
    private workerLoopPromise: Promise<void> | null = null;

    constructor(properties: RedisConnectorProperties = {}) {
        const url = properties.url ?? properties.URL;
        const host = properties.host ?? properties.HOST ?? "127.0.0.1";
        const port = Number(properties.port ?? properties.PORT ?? 6379);
        const password = properties.password ?? properties.PASSWORD;
        const db = Number(properties.db ?? properties.DB ?? 0);

        this.telemetryTopic =
            properties.telemetryTopic ??
            properties.TELEMETRY_TOPIC ??
            "agentic:telemetry";
        this.commandsStream =
            properties.commandsStream ??
            properties.COMMANDS_STREAM ??
            "agentic:commands";
        this.consumerGroup =
            properties.consumerGroup ??
            properties.CONSUMER_GROUP ??
            "agentic:workers";
        this.consumerName =
            properties.consumerName ??
            properties.CONSUMER_NAME ??
            `worker-${randomUUID().slice(0, 8)}`;

        const options: RedisOptions = {
            lazyConnect: true,
            maxRetriesPerRequest: null,
            enableReadyCheck: false,
        };
        if (password) options.password = password;
        if (db) options.db = db;

        if (url) {
            this.publisher = new Redis(url, options);
            this.subscriber = new Redis(url, options);
            this.workerClient = new Redis(url, options);
        } else {
            this.publisher = new Redis({ ...options, host, port });
            this.subscriber = new Redis({ ...options, host, port });
            this.workerClient = new Redis({ ...options, host, port });
        }
    }

    async init(): Promise<void> {
        this.isDestroyed = false;

        // Connect clients
        await Promise.all([
            this.publisher.connect(),
            this.subscriber.connect(),
            this.workerClient.connect(),
        ]);

        // Subscribe to broadcast topic
        await this.subscriber.subscribe(this.telemetryTopic);
        this.subscriber.on("message", (channel, message) => {
            if (channel === this.telemetryTopic) {
                try {
                    const parsed = JSON.parse(message);
                    const handlers = this.broadcastHandlers.get(parsed.event);
                    if (handlers) {
                        for (const handler of handlers) {
                            try {
                                const res = handler(parsed.payload);
                                if (res && typeof (res as Promise<any>).catch === "function") {
                                    (res as Promise<any>).catch(() => {});
                                }
                            } catch {
                                // Handlers should not crash subscriber
                            }
                        }
                    }
                } catch {
                    // Ignore malformed broadcast messages
                }
            }
        });

        // Initialize consumer group for streams
        try {
            await this.publisher.xgroup(
                "CREATE",
                this.commandsStream,
                this.consumerGroup,
                "$",
                "MKSTREAM",
            );
        } catch (err: any) {
            // BUSYGROUP Consumer Group name already exists is expected on restart
            if (!String(err?.message ?? err).includes("BUSYGROUP")) {
                // Ignore if group already exists
            }
        }

        // Start background worker loop
        this.workerLoopPromise = this.startWorkerLoop();
    }

    private async startWorkerLoop(): Promise<void> {
        while (!this.isDestroyed) {
            try {
                // XREADGROUP block for 1000ms
                const result = await (this.workerClient as any).xreadgroup(
                    "GROUP",
                    this.consumerGroup,
                    this.consumerName,
                    "COUNT",
                    10,
                    "BLOCK",
                    1000,
                    "STREAMS",
                    this.commandsStream,
                    ">",
                );

                if (result && Array.isArray(result)) {
                    for (const [, messages] of result as any) {
                        for (const [id, fields] of messages) {
                            let eventName: keyof AgentEventMap | undefined;
                            let payload: any;

                            for (let i = 0; i < fields.length; i += 2) {
                                if (fields[i] === "event") {
                                    eventName = fields[i + 1];
                                } else if (fields[i] === "payload") {
                                    try {
                                        payload = JSON.parse(fields[i + 1]);
                                    } catch {
                                        payload = fields[i + 1];
                                    }
                                }
                            }

                            if (eventName && payload !== undefined) {
                                const handlers = this.queueHandlers.get(eventName);
                                if (handlers && handlers.size > 0) {
                                    await Promise.all(
                                        Array.from(handlers).map(async (handler) => {
                                            try {
                                                await handler(payload);
                                            } catch {
                                                // Handle failure gracefully
                                            }
                                        }),
                                    );
                                }
                            }

                            // Acknowledge processed message
                            try {
                                await this.publisher.xack(
                                    this.commandsStream,
                                    this.consumerGroup,
                                    id,
                                );
                            } catch {
                                // Ignore ack errors on shutdown
                            }
                        }
                    }
                }
            } catch (err) {
                if (this.isDestroyed) break;
                // Wait briefly before retrying to prevent hot loop on connection errors
                await new Promise((resolve) => setTimeout(resolve, 200));
            }
        }
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
        const mode = this.resolveDeliveryMode(event, options?.delivery);

        if (mode === "queue") {
            await this.publisher.xadd(
                this.commandsStream,
                "*",
                "event",
                String(event),
                "payload",
                JSON.stringify(payload),
            );
        } else {
            await this.publisher.publish(
                this.telemetryTopic,
                JSON.stringify({ event, payload }),
            );
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
            await this.subscriber.unsubscribe(this.telemetryTopic);
        } catch {
            // Ignore unsubscribe errors
        }

        try {
            this.publisher.disconnect();
            this.subscriber.disconnect();
            this.workerClient.disconnect();
        } catch {
            // Ignore disconnect errors
        }

        if (this.workerLoopPromise) {
            await Promise.race([
                this.workerLoopPromise,
                new Promise((resolve) => setTimeout(resolve, 500)),
            ]);
        }
    }
}

export function createCommunicator(
    properties: RedisConnectorProperties = {},
): RedisAgentCommunicator {
    return new RedisAgentCommunicator(properties);
}

export default RedisAgentCommunicator;
