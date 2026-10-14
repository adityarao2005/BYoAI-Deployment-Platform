import {
    type Span,
    SpanStatusCode,
    type Tracer,
    context,
    trace,
} from "@opentelemetry/api";
import { OTLPTraceExporter as GrpcTraceExporter } from "@opentelemetry/exporter-trace-otlp-grpc";
import { OTLPTraceExporter as HttpTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
    BatchSpanProcessor,
    SimpleSpanProcessor,
    type SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import type { AgentObserver, ModelTurnMetadata } from "@/agents/agent.observer";
import { getLogger } from "@/logger";
import type { ModelMessageOutput } from "@/models";

export type OtelProtocol = "http" | "grpc";

export interface OpenTelemetryObserverOptions {
    /** Target OTLP endpoint URL (e.g. "http://localhost:4318" or "localhost:4317") */
    endpoint?: string;
    /** OTLP transport protocol ("http" or "grpc"). Auto-detected if omitted. */
    protocol?: OtelProtocol;
    /** Logical service name identifying the agent runtime in telemetry (defaults to "byo-ai-agent") */
    serviceName?: string;
    /** Optional custom HTTP or gRPC headers (e.g. authentication tokens) */
    headers?: Record<string, string>;
    /** Optional custom SpanProcessor or pre-configured TracerProvider */
    provider?: NodeTracerProvider;
    /** Optional pre-existing Tracer instance */
    tracer?: Tracer;
}

/**
 * OpenTelemetry Agent Observer
 *
 * Emits OpenTelemetry traces, spans, and metrics for all agent turns, model prompts, token usage,
 * and tool executions across the BYoAI Agent runtime.
 */
export class OpenTelemetryAgentObserver implements AgentObserver {
    private readonly tracer: Tracer;
    private readonly provider?: NodeTracerProvider;
    private readonly logger = getLogger("OpenTelemetryAgentObserver");

    // Active spans mapped by agent ID or tool call ID
    private readonly turnSpans = new Map<string, Span>();
    private readonly modelSpans = new Map<string, Span>();
    private readonly toolSpans = new Map<string, Span>();

    constructor(options: OpenTelemetryObserverOptions = {}) {
        if (options.tracer) {
            this.tracer = options.tracer;
            this.provider = options.provider;
            return;
        }

        const serviceName = options.serviceName ?? "byo-ai-agent";
        const protocol = options.protocol ?? this.detectProtocol(options.endpoint);
        const endpoint = options.endpoint;

        const exporter = this.createExporter(protocol, endpoint, options.headers);
        const isTest =
            process.env.NODE_ENV === "test" || process.env.BUN_ENV === "test";

        const processor: SpanProcessor = isTest
            ? new SimpleSpanProcessor(exporter)
            : new BatchSpanProcessor(exporter);

        const provider =
            options.provider ??
            new NodeTracerProvider({
                resource: resourceFromAttributes({
                    [ATTR_SERVICE_NAME]: serviceName,
                }),
                spanProcessors: [processor],
            });

        provider.register();

        this.provider = provider;
        this.tracer = provider.getTracer(serviceName);

        this.logger.debug("OpenTelemetryAgentObserver initialized", {
            serviceName,
            protocol,
            endpoint: endpoint ?? "(default collector)",
        });
    }

    private detectProtocol(endpoint?: string): OtelProtocol {
        if (!endpoint) return "http";
        const trimmed = endpoint.trim().toLowerCase();
        if (trimmed.startsWith("grpc://") || trimmed.includes(":4317")) {
            return "grpc";
        }
        return "http";
    }

    private createExporter(
        protocol: OtelProtocol,
        endpoint?: string,
        headers?: Record<string, string>,
    ) {
        if (protocol === "grpc") {
            let grpcUrl = endpoint;
            if (grpcUrl?.startsWith("grpc://")) {
                grpcUrl = `http://${grpcUrl.slice(7)}`;
            }
            return new GrpcTraceExporter({
                ...(grpcUrl ? { url: grpcUrl } : {}),
                ...(headers ? { metadata: headers as any } : {}),
            });
        }

        return new HttpTraceExporter({
            ...(endpoint ? { url: endpoint } : {}),
            ...(headers ? { headers } : {}),
        });
    }

    /**
     * Called when an agent turn begins with a user prompt.
     */
    onTurnStart(agentId: string, userMessage: string): void {
        try {
            const span = this.tracer.startSpan("agent.turn", {
                attributes: {
                    "agent.id": agentId,
                    "agent.turn.user_message": userMessage,
                },
            });

            this.turnSpans.set(agentId, span);
        } catch (error) {
            this.logger.debug("Error in onTurnStart", { error });
        }
    }

    /**
     * Called when a model call starts.
     */
    onModelStart(agentId: string, prompt: string): void {
        try {
            const turnSpan = this.turnSpans.get(agentId);
            const parentContext = turnSpan
                ? trace.setSpan(context.active(), turnSpan)
                : context.active();

            const span = this.tracer.startSpan(
                "model.execute",
                {
                    attributes: {
                        "agent.id": agentId,
                        "gen_ai.prompt_preview": prompt.slice(0, 500),
                    },
                },
                parentContext,
            );

            this.modelSpans.set(agentId, span);
        } catch (error) {
            this.logger.debug("Error in onModelStart", { error });
        }
    }

    /**
     * Called when a model call successfully completes with message or tool outputs.
     */
    onModelEnd(
        agentId: string,
        output: ModelMessageOutput[],
        metadata?: ModelTurnMetadata,
    ): void {
        try {
            const span = this.modelSpans.get(agentId);
            if (!span) return;

            if (metadata?.model) {
                span.setAttribute("gen_ai.request.model", metadata.model);
            }

            const usage =
                metadata?.usage ?? output.find((m) => m.usage !== undefined)?.usage;

            if (usage) {
                if (usage.inputTokens !== undefined) {
                    span.setAttribute("gen_ai.usage.input_tokens", usage.inputTokens);
                }
                if (usage.outputTokens !== undefined) {
                    span.setAttribute(
                        "gen_ai.usage.output_tokens",
                        usage.outputTokens,
                    );
                }
                if (usage.totalTokens !== undefined) {
                    span.setAttribute("gen_ai.usage.total_tokens", usage.totalTokens);
                }
            }

            span.setAttribute("gen_ai.output_count", output.length);
            span.setStatus({ code: SpanStatusCode.OK });
            span.end();
            this.modelSpans.delete(agentId);
        } catch (error) {
            this.logger.debug("Error in onModelEnd", { error });
        }
    }

    /**
     * Called when an assistant message is emitted to the conversation.
     */
    onAgentMessage(agentId: string, content: string): void {
        try {
            const turnSpan = this.turnSpans.get(agentId);
            if (turnSpan) {
                turnSpan.addEvent("agent.message", {
                    "message.content": content.slice(0, 1000),
                });
            }
        } catch (error) {
            this.logger.debug("Error in onAgentMessage", { error });
        }
    }

    /**
     * Called when a tool call begins execution.
     */
    onToolCallStart(
        agentId: string,
        toolCallId: string,
        tool: string,
        args: Record<string, any>,
    ): void {
        try {
            const turnSpan = this.turnSpans.get(agentId);
            const parentContext = turnSpan
                ? trace.setSpan(context.active(), turnSpan)
                : context.active();

            let argsJson = "";
            try {
                argsJson = JSON.stringify(args);
            } catch {
                argsJson = "[Unserializable Args]";
            }

            const span = this.tracer.startSpan(
                `tool.execute:${tool}`,
                {
                    attributes: {
                        "agent.id": agentId,
                        "tool.id": toolCallId,
                        "tool.name": tool,
                        "tool.arguments": argsJson.slice(0, 2000),
                    },
                },
                parentContext,
            );

            this.toolSpans.set(toolCallId, span);
        } catch (error) {
            this.logger.debug("Error in onToolCallStart", { error });
        }
    }

    /**
     * Called when a tool execution completes or fails.
     */
    onToolCallEnd(
        agentId: string,
        toolCallId: string,
        tool: string,
        result: any,
        error?: unknown,
    ): void {
        try {
            const span = this.toolSpans.get(toolCallId);
            if (!span) return;

            if (error) {
                const err = error instanceof Error ? error : new Error(String(error));
                span.recordException(err);
                span.setStatus({
                    code: SpanStatusCode.ERROR,
                    message: err.message,
                });
            } else {
                let resultJson = "";
                try {
                    resultJson =
                        typeof result === "string" ? result : JSON.stringify(result);
                } catch {
                    resultJson = "[Unserializable Result]";
                }
                span.setAttribute("tool.result", resultJson.slice(0, 2000));
                span.setStatus({ code: SpanStatusCode.OK });
            }

            span.end();
            this.toolSpans.delete(toolCallId);
        } catch (err) {
            this.logger.debug("Error in onToolCallEnd", { error: err });
        }
    }

    /**
     * Called when an unhandled error occurs during the execution loop.
     */
    onError(agentId: string, error: unknown, contextDesc?: string): void {
        try {
            const err = error instanceof Error ? error : new Error(String(error));
            const turnSpan = this.turnSpans.get(agentId);
            if (turnSpan) {
                turnSpan.recordException(err);
                turnSpan.setStatus({
                    code: SpanStatusCode.ERROR,
                    message: `${contextDesc ?? "agent:error"}: ${err.message}`,
                });
            }
        } catch (e) {
            this.logger.debug("Error in onError", { error: e });
        }
    }

    /**
     * Called when an agent turn ends.
     */
    onTurnEnd(agentId: string, error?: unknown): void {
        try {
            const span = this.turnSpans.get(agentId);
            if (!span) return;

            if (error) {
                const err = error instanceof Error ? error : new Error(String(error));
                span.recordException(err);
                span.setStatus({
                    code: SpanStatusCode.ERROR,
                    message: err.message,
                });
            } else {
                span.setStatus({ code: SpanStatusCode.OK });
            }

            span.end();
            this.turnSpans.delete(agentId);
        } catch (err) {
            this.logger.debug("Error in onTurnEnd", { error: err });
        }
    }

    /**
     * Gracefully flushes and shuts down the tracer provider.
     */
    async shutdown(): Promise<void> {
        try {
            await this.provider?.shutdown();
        } catch (error) {
            this.logger.debug("Error shutting down OpenTelemetry provider", { error });
        }
    }
}
