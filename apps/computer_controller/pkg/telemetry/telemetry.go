package telemetry

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/adityarao2005/BYoAI-Deployment-Platform/computer_controller/pkg/config"
	"github.com/adityarao2005/BYoAI-Deployment-Platform/computer_controller/pkg/logger"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
)

// Init sets up the OpenTelemetry TracerProvider and returns a shutdown function.
func Init(cfg config.TelemetryConfig) (func(context.Context) error, error) {
	if !cfg.IsEnabled() {
		return func(context.Context) error { return nil }, nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	protocol := strings.ToLower(cfg.Protocol)
	endpoint := cfg.OtelEndpoint

	if protocol == "" {
		if strings.HasPrefix(endpoint, "grpc://") || strings.Contains(endpoint, ":4317") {
			protocol = "grpc"
		} else {
			protocol = "http"
		}
	}

	var exporter sdktrace.SpanExporter
	var err error

	if protocol == "grpc" {
		cleanEndpoint := strings.TrimPrefix(endpoint, "grpc://")
		cleanEndpoint = strings.TrimPrefix(cleanEndpoint, "http://")
		cleanEndpoint = strings.TrimPrefix(cleanEndpoint, "https://")
		exporter, err = otlptracegrpc.New(ctx,
			otlptracegrpc.WithEndpoint(cleanEndpoint),
			otlptracegrpc.WithInsecure(),
		)
	} else {
		cleanEndpoint := strings.TrimPrefix(endpoint, "http://")
		cleanEndpoint = strings.TrimPrefix(cleanEndpoint, "https://")
		exporter, err = otlptracehttp.New(ctx,
			otlptracehttp.WithEndpoint(cleanEndpoint),
			otlptracehttp.WithInsecure(),
		)
	}

	if err != nil {
		return nil, fmt.Errorf("failed to create OTLP trace exporter: %w", err)
	}

	res, err := resource.New(ctx,
		resource.WithAttributes(
			semconv.ServiceName(cfg.ServiceName),
		),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create telemetry resource: %w", err)
	}

	tp := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exporter),
		sdktrace.WithResource(res),
	)

	otel.SetTracerProvider(tp)
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	))

	logger.Info("Initialized OpenTelemetry for Computer Controller",
		"service", cfg.ServiceName,
		"endpoint", cfg.OtelEndpoint,
		"protocol", protocol,
	)

	return tp.Shutdown, nil
}
