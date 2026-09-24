package logger_test

import (
	"bytes"
	"strings"
	"testing"

	"github.com/adityarao2005/BYoAI-Deployment-Platform/computer_controller/pkg/logger"
)

func TestLoggerInitAndLevels(t *testing.T) {
	var buf bytes.Buffer
	logger.Init("debug", "json", &buf)

	logger.Debug("debug message", "key", "val1")
	logger.Info("info message", "key", "val2")

	output := buf.String()
	if !strings.Contains(output, "debug message") {
		t.Errorf("expected debug message in output, got: %s", output)
	}
	if !strings.Contains(output, "info message") {
		t.Errorf("expected info message in output, got: %s", output)
	}
	if !strings.Contains(output, `"key":"val1"`) {
		t.Errorf("expected json metadata in output, got: %s", output)
	}
}

func TestLoggerFilterLevels(t *testing.T) {
	var buf bytes.Buffer
	logger.Init("warn", "text", &buf)

	logger.Debug("should not appear")
	logger.Info("should not appear")
	logger.Warn("warning message")

	output := buf.String()
	if strings.Contains(output, "should not appear") {
		t.Errorf("did not expect debug/info messages under warn level, got: %s", output)
	}
	if !strings.Contains(output, "warning message") {
		t.Errorf("expected warning message in output, got: %s", output)
	}
}
