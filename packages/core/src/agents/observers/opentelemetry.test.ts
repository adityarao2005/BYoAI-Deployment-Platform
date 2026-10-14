import { describe, expect, it } from "bun:test";
import {
    InMemorySpanExporter,
    SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { SpanStatusCode } from "@opentelemetry/api";
import {
    type AgentConfiguration,
    AgentManager,
    InMemoryUserTokenManager,
} from "@/agents";
import type { AgentEventMap } from "@/agents/agent.messaging";
import type { Model } from "@/models/models";
import { InMemoryAgentCommunicator } from "../communication";
import { InMemoryAgentMemoryManager } from "../memory";
import { OpenTelemetryAgentObserver } from "./opentelemetry";

function waitForEvent<K extends keyof AgentEventMap>(
    communicator: InMemoryAgentCommunicator,
    event: K,
    timeoutMs = 5000,
): Promise<AgentEventMap[K]> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error(`Timed out waiting for '${event}' event`)),
            timeoutMs,
        );
        const unsub = communicator.on(event, (payload) => {
            clearTimeout(timer);
            unsub();
            resolve(payload);
        });
    });
}

describe("OpenTelemetryAgentObserver", () => {
    it("auto-detects HTTP and gRPC protocols from endpoint URLs", () => {
        const httpObserver = new OpenTelemetryAgentObserver({
            endpoint: "http://localhost:4318/v1/traces",
        });
        expect(httpObserver).toBeDefined();

        const grpcObserver = new OpenTelemetryAgentObserver({
            endpoint: "localhost:4317",
        });
        expect(grpcObserver).toBeDefined();

        const grpcSchemeObserver = new OpenTelemetryAgentObserver({
            endpoint: "grpc://collector:4317",
        });
        expect(grpcSchemeObserver).toBeDefined();
    });

    it("records full lifecycle spans with attributes and token usage", async () => {
        const memoryExporter = new InMemorySpanExporter();
        const provider = new NodeTracerProvider({
            spanProcessors: [new SimpleSpanProcessor(memoryExporter)],
        });
        provider.register();

        const observer = new OpenTelemetryAgentObserver({
            provider,
            serviceName: "test-agent-service",
        });

        const agentId = "agent-otel-1";
        const toolCallId = "call-123";

        // Turn begins
        observer.onTurnStart(agentId, "What is the capital of France?");

        // Model call
        observer.onModelStart(agentId, "System: Answer questions accurately.");
        observer.onModelEnd(
            agentId,
            [
                {
                    role: "assistant",
                    type: "message",
                    content: "The capital of France is Paris.",
                    usage: {
                        inputTokens: 15,
                        outputTokens: 7,
                        totalTokens: 22,
                    },
                },
            ],
            {
                model: "gpt-4o",
                usage: {
                    inputTokens: 15,
                    outputTokens: 7,
                    totalTokens: 22,
                },
            },
        );

        // Agent message
        observer.onAgentMessage(agentId, "The capital of France is Paris.");

        // Tool call start & end
        observer.onToolCallStart(agentId, toolCallId, "web_search", {
            query: "capital of France",
        });
        observer.onToolCallEnd(
            agentId,
            toolCallId,
            "web_search",
            { answer: "Paris" },
        );

        // Turn ends
        observer.onTurnEnd(agentId);

        const spans = memoryExporter.getFinishedSpans();
        expect(spans.length).toBe(3); // model.execute, tool.execute:web_search, agent.turn

        // Check model span
        const modelSpan = spans.find((s) => s.name === "model.execute");
        expect(modelSpan).toBeDefined();
        expect(modelSpan?.attributes["gen_ai.request.model"]).toBe("gpt-4o");
        expect(modelSpan?.attributes["gen_ai.usage.input_tokens"]).toBe(15);
        expect(modelSpan?.attributes["gen_ai.usage.output_tokens"]).toBe(7);
        expect(modelSpan?.attributes["gen_ai.usage.total_tokens"]).toBe(22);
        expect(modelSpan?.status.code).toBe(SpanStatusCode.OK);

        // Check tool span
        const toolSpan = spans.find((s) => s.name === "tool.execute:web_search");
        expect(toolSpan).toBeDefined();
        expect(toolSpan?.attributes["tool.id"]).toBe(toolCallId);
        expect(toolSpan?.attributes["tool.name"]).toBe("web_search");
        expect(toolSpan?.attributes["tool.result"]).toContain("Paris");
        expect(toolSpan?.status.code).toBe(SpanStatusCode.OK);

        // Check turn span
        const turnSpan = spans.find((s) => s.name === "agent.turn");
        expect(turnSpan).toBeDefined();
        expect(turnSpan?.attributes["agent.id"]).toBe(agentId);
        expect(turnSpan?.attributes["agent.turn.user_message"]).toBe(
            "What is the capital of France?",
        );
        expect(turnSpan?.events.some((e) => e.name === "agent.message")).toBe(true);

        await observer.shutdown();
    });

    it("records tool execution errors and unhandled agent errors properly", async () => {
        const memoryExporter = new InMemorySpanExporter();
        const provider = new NodeTracerProvider({
            spanProcessors: [new SimpleSpanProcessor(memoryExporter)],
        });

        const observer = new OpenTelemetryAgentObserver({
            provider,
            serviceName: "error-test-agent",
        });

        const agentId = "agent-error-1";
        const toolCallId = "call-err-99";

        observer.onTurnStart(agentId, "Run failing tool");
        observer.onToolCallStart(agentId, toolCallId, "failing_tool", { flag: true });
        observer.onToolCallEnd(
            agentId,
            toolCallId,
            "failing_tool",
            null,
            new Error("Tool failed with timeout"),
        );
        observer.onError(agentId, new Error("Turn failed"), "turn:execution");
        observer.onTurnEnd(agentId, new Error("Turn failed"));

        const spans = memoryExporter.getFinishedSpans();
        const toolSpan = spans.find((s) => s.name === "tool.execute:failing_tool");
        expect(toolSpan).toBeDefined();
        expect(toolSpan?.status.code).toBe(SpanStatusCode.ERROR);
        expect(toolSpan?.status.message).toContain("Tool failed with timeout");

        const turnSpan = spans.find((s) => s.name === "agent.turn");
        expect(turnSpan).toBeDefined();
        expect(turnSpan?.status.code).toBe(SpanStatusCode.ERROR);

        await observer.shutdown();
    });

    it("integrates seamlessly into AgentManager execution loop", async () => {
        const memoryExporter = new InMemorySpanExporter();
        const provider = new NodeTracerProvider({
            spanProcessors: [new SimpleSpanProcessor(memoryExporter)],
        });

        const observer = new OpenTelemetryAgentObserver({
            provider,
            serviceName: "agent-manager-otel-test",
        });

        const fakeModel: Model = {
            name: "test-model-tracked",
            execute: async () => [
                {
                    role: "assistant",
                    type: "message",
                    content: "Hello from traced model!",
                    usage: {
                        inputTokens: 10,
                        outputTokens: 5,
                        totalTokens: 15,
                    },
                },
            ],
        };

        const communicator = new InMemoryAgentCommunicator();
        const memoryManager = new InMemoryAgentMemoryManager();
        const tokenManager = new InMemoryUserTokenManager();

        const config: AgentConfiguration = {
            name: "otel-integrated-agent",
            description: "An agent instrumented with OpenTelemetry",
            model: fakeModel,
            skillRepository: [],
            toolProviders: [],
            memoryManager,
            userTokenManager: tokenManager,
            communicator,
            observers: [observer],
        };

        const manager = new AgentManager(config);
        await manager.init();

        const completedPromise = waitForEvent(communicator, "agent:complete");
        const agent = await manager.createAgent("user-1");
        await communicator.emit("user:message", {
            agentId: agent.id,
            content: "Hello test!",
        });
        await completedPromise;

        const spans = memoryExporter.getFinishedSpans();
        expect(spans.length).toBeGreaterThanOrEqual(2);

        const modelSpan = spans.find((s) => s.name === "model.execute");
        expect(modelSpan).toBeDefined();
        expect(modelSpan?.attributes["gen_ai.request.model"]).toBe("test-model-tracked");
        expect(modelSpan?.attributes["gen_ai.usage.total_tokens"]).toBe(15);

        const turnSpan = spans.find((s) => s.name === "agent.turn");
        expect(turnSpan).toBeDefined();
        expect(turnSpan?.attributes["agent.turn.user_message"]).toBe("Hello test!");

        await observer.shutdown();
    });
});
