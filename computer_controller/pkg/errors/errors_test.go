package errors_test

import (
	"fmt"
	"testing"

	"connectrpc.com/connect"
	"github.com/adityarao2005/BYoAI-Deployment-Platform/computer_controller/pkg/errors"
)

func TestToConnectError(t *testing.T) {
	tests := []struct {
		input        error
		expectedCode connect.Code
	}{
		{errors.ErrNotFound, connect.CodeNotFound},
		{errors.ErrUnauthorized, connect.CodeUnauthenticated},
		{errors.ErrInvalidConfig, connect.CodeInvalidArgument},
		{errors.ErrPermissionDenied, connect.CodePermissionDenied},
		{errors.ErrNotImplemented, connect.CodeUnimplemented},
		{fmt.Errorf("random error"), connect.CodeInternal},
	}

	for _, tt := range tests {
		err := errors.ToConnectError(tt.input)
		connectErr, ok := err.(*connect.Error)
		if !ok {
			t.Fatalf("expected *connect.Error for input %v, got %T", tt.input, err)
		}
		if connectErr.Code() != tt.expectedCode {
			t.Errorf("expected code %v, got %v for input %v", tt.expectedCode, connectErr.Code(), tt.input)
		}
	}
}
