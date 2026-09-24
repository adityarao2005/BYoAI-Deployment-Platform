package logger

import (
	"context"
	"io"
	"log/slog"
	"os"
	"strings"
	"sync"
)

var (
	globalLogger *slog.Logger
	once         sync.Once
)

func init() {
	Init("info", "text", os.Stdout)
}

// Init configures the global slog logger instance with the specified log level and format.
func Init(levelStr, formatStr string, output io.Writer) {
	var level slog.Level
	switch strings.ToLower(levelStr) {
	case "debug":
		level = slog.LevelDebug
	case "warn", "warning":
		level = slog.LevelWarn
	case "error":
		level = slog.LevelError
	default:
		level = slog.LevelInfo
	}

	opts := &slog.HandlerOptions{
		Level: level,
	}

	var handler slog.Handler
	if strings.ToLower(formatStr) == "json" {
		handler = slog.NewJSONHandler(output, opts)
	} else {
		handler = slog.NewTextHandler(output, opts)
	}

	globalLogger = slog.New(handler)
	slog.SetDefault(globalLogger)
}

// Get returns the global slog.Logger instance.
func Get() *slog.Logger {
	return globalLogger
}

// Debug logs a debug message with structured key-value context.
func Debug(msg string, args ...any) {
	globalLogger.Debug(msg, args...)
}

// Info logs an info message with structured key-value context.
func Info(msg string, args ...any) {
	globalLogger.Info(msg, args...)
}

// Warn logs a warning message with structured key-value context.
func Warn(msg string, args ...any) {
	globalLogger.Warn(msg, args...)
}

// Error logs an error message with structured key-value context.
func Error(msg string, args ...any) {
	globalLogger.Error(msg, args...)
}

// Fatal logs an error message and terminates the application.
func Fatal(msg string, args ...any) {
	globalLogger.Error(msg, args...)
	os.Exit(1)
}

// With returns a new Logger that includes the given attributes.
func With(args ...any) *slog.Logger {
	return globalLogger.With(args...)
}

// LogAttrs logs a record with specified level and attributes.
func LogAttrs(ctx context.Context, level slog.Level, msg string, attrs ...slog.Attr) {
	globalLogger.LogAttrs(ctx, level, msg, attrs...)
}
