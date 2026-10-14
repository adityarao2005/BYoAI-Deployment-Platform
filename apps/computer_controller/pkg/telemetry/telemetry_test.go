package telemetry

import (
	"context"
	"testing"
	"time"

	"github.com/adityarao2005/BYoAI-Deployment-Platform/computer_controller/pkg/config"
)

func TestTelemetryInitDisabled(t *testing.T) {
	cfg := config.TelemetryConfig{
		OtelEndpoint: "",
	}

	shutdown, err := Init(cfg)
	if err != nil {
		t.Fatalf("expected no error for disabled telemetry, got: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()

	if err := shutdown(ctx); err != nil {
		t.Fatalf("expected clean shutdown, got: %v", err)
	}
}

func TestTelemetryInitHttpAndGrpc(t *testing.T) {
	tests := []struct {
		name string
		cfg  config.TelemetryConfig
	}{
		{
			name: "http endpoint auto-detect",
			cfg: config.TelemetryConfig{
				OtelEndpoint: "http://localhost:4318",
				ServiceName:  "test-controller-http",
			},
		},
		{
			name: "grpc endpoint auto-detect",
			cfg: config.TelemetryConfig{
				OtelEndpoint: "localhost:4317",
				ServiceName:  "test-controller-grpc",
			},
		},
		{
			name: "explicit grpc protocol with scheme",
			cfg: config.TelemetryConfig{
				OtelEndpoint: "grpc://collector:4317",
				Protocol:     "grpc",
				ServiceName:  "test-controller-explicit-grpc",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			shutdown, err := Init(tt.cfg)
			if err != nil {
				t.Fatalf("unexpected error initializing telemetry: %v", err)
			}

			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()

			if err := shutdown(ctx); err != nil {
				t.Errorf("error during shutdown: %v", err)
			}
		})
	}
}
