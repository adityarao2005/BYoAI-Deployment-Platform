package errors

import (
	"errors"
	"fmt"

	"connectrpc.com/connect"
)

var (
	ErrNotFound             = errors.New("resource not found")
	ErrUnauthorized         = errors.New("unauthorized")
	ErrInvalidConfig        = errors.New("invalid configuration")
	ErrContainerStartFailed = errors.New("container start failed")
	ErrCommandFailed        = errors.New("command execution failed")
	ErrPermissionDenied     = errors.New("permission denied")
	ErrNotImplemented       = errors.New("feature not implemented")
)

// ControllerError represents a structured error in the computer controller with an internal code.
type ControllerError struct {
	Code    string
	Message string
	Err     error
}

func (e *ControllerError) Error() string {
	if e.Err != nil {
		return fmt.Sprintf("[%s] %s: %v", e.Code, e.Message, e.Err)
	}
	return fmt.Sprintf("[%s] %s", e.Code, e.Message)
}

func (e *ControllerError) Unwrap() error {
	return e.Err
}

// New creates a new ControllerError with a code and message.
func New(code, message string, cause error) *ControllerError {
	return &ControllerError{
		Code:    code,
		Message: message,
		Err:     cause,
	}
}

// ToConnectError maps internal domain errors into appropriate ConnectRPC gRPC status errors.
func ToConnectError(err error) error {
	if err == nil {
		return nil
	}

	var connectErr *connect.Error
	if errors.As(err, &connectErr) {
		return err
	}

	switch {
	case errors.Is(err, ErrNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	case errors.Is(err, ErrUnauthorized):
		return connect.NewError(connect.CodeUnauthenticated, err)
	case errors.Is(err, ErrInvalidConfig):
		return connect.NewError(connect.CodeInvalidArgument, err)
	case errors.Is(err, ErrPermissionDenied):
		return connect.NewError(connect.CodePermissionDenied, err)
	case errors.Is(err, ErrNotImplemented):
		return connect.NewError(connect.CodeUnimplemented, err)
	default:
		return connect.NewError(connect.CodeInternal, err)
	}
}
