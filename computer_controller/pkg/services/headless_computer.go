package services

import (
	"context"
	"errors"
	"net/http"
	"sync"

	"connectrpc.com/connect"
	"connectrpc.com/validate"

	computer_apiv1 "github.com/adityarao2005/BYoAI-Deployment-Platform/computer_controller/gen/computer_api/v1"
	"github.com/adityarao2005/BYoAI-Deployment-Platform/computer_controller/gen/computer_api/v1/computer_apiv1connect"
	"github.com/adityarao2005/BYoAI-Deployment-Platform/computer_controller/pkg/computer"
	"github.com/adityarao2005/BYoAI-Deployment-Platform/computer_controller/pkg/logger"
)

type BasicComputerService struct {
	provider computer.IComputerProvider
}

func (s *BasicComputerService) Execute(
	ctx context.Context,
	req *connect.Request[computer_apiv1.ExecuteRequest],
) (*connect.Response[computer_apiv1.ExecuteResponse], error) {
	logger.Info("Execute RPC called", "sessionId", req.Msg.GetSessionId(), "command", req.Msg.GetCommand())
	comp, err := s.provider.GetComputer(ctx, req.Msg.GetSessionId())
	if err != nil {
		logger.Error("Execute RPC failed to find computer", "sessionId", req.Msg.GetSessionId(), "error", err)
		return connect.NewResponse(&computer_apiv1.ExecuteResponse{
			Result: &computer_apiv1.ExecuteResponse_ErrorMessage{
				ErrorMessage: err.Error(),
			},
		}), nil
	}

	execInput := computer.ExecInput{
		Command:   req.Msg.GetCommand(),
		Cwd:       req.Msg.Cwd,
		Stdin:     req.Msg.Stdin,
		Shell:     req.Msg.Shell,
		ShellArgs: req.Msg.GetShellArgs(),
	}

	if len(req.Msg.GetEnvVars()) > 0 {
		var envVars []computer.EnvVar
		for k, v := range req.Msg.GetEnvVars() {
			envVars = append(envVars, computer.EnvVar{Name: k, Value: v})
		}
		execInput.Env = envVars
	}

	if req.Msg.WaitDelay != nil {
		duration := req.Msg.WaitDelay.AsDuration()
		execInput.WaitDelay = &duration
	}

	res, err := comp.Execute(ctx, execInput)
	if err != nil {
		return connect.NewResponse(&computer_apiv1.ExecuteResponse{
			Result: &computer_apiv1.ExecuteResponse_ErrorMessage{
				ErrorMessage: err.Error(),
			},
		}), nil
	}

	return connect.NewResponse(&computer_apiv1.ExecuteResponse{
		Result: &computer_apiv1.ExecuteResponse_ExecResult{
			ExecResult: &computer_apiv1.ExecutionResult{
				ExitCode: int32(res.ExitCode),
				Stdout:   res.Stdout,
				Stderr:   res.Stderr,
			},
		},
	}), nil
}

func (s *BasicComputerService) ExecuteStream(
	ctx context.Context,
	stream *connect.BidiStream[computer_apiv1.ExecuteStreamRequest, computer_apiv1.ExecuteStreamResponse],
) error {
	// 1. Read the first message — must be a config message
	firstMsg, err := stream.Receive()
	if err != nil {
		return connect.NewError(connect.CodeInvalidArgument, errors.New("failed to receive initial config message"))
	}

	config := firstMsg.GetConfig()
	if config == nil {
		return connect.NewError(connect.CodeInvalidArgument, errors.New("first message must be an ExecuteStreamConfig"))
	}

	logger.Info("ExecuteStream RPC started", "sessionId", config.GetSessionId(), "command", config.GetCommand())

	// 2. Look up the computer
	comp, err := s.provider.GetComputer(ctx, config.GetSessionId())
	if err != nil {
		_ = stream.Send(&computer_apiv1.ExecuteStreamResponse{
			Output: &computer_apiv1.ExecuteStreamResponse_ErrorMessage{
				ErrorMessage: err.Error(),
			},
		})
		return nil
	}

	// 3. Build ExecInput from config
	execInput := computer.ExecInput{
		Command:   config.GetCommand(),
		Shell:     config.Shell,
		ShellArgs: config.GetShellArgs(),
	}
	if config.Cwd != nil {
		execInput.Cwd = config.Cwd
	}
	if len(config.GetEnvVars()) > 0 {
		var envVars []computer.EnvVar
		for k, v := range config.GetEnvVars() {
			envVars = append(envVars, computer.EnvVar{Name: k, Value: v})
		}
		execInput.Env = envVars
	}

	// 4. Start the streaming execution session
	session, err := comp.ExecuteStream(ctx, execInput)
	if err != nil {
		_ = stream.Send(&computer_apiv1.ExecuteStreamResponse{
			Output: &computer_apiv1.ExecuteStreamResponse_ErrorMessage{
				ErrorMessage: err.Error(),
			},
		})
		return nil
	}

	// Use a mutex for thread-safe sends on the stream
	var sendMu sync.Mutex
	sendMsg := func(msg *computer_apiv1.ExecuteStreamResponse) error {
		sendMu.Lock()
		defer sendMu.Unlock()
		return stream.Send(msg)
	}

	// 5. Forward stdout and stderr from the process to the client
	var ioWg sync.WaitGroup

	// stdout forwarder
	ioWg.Add(1)
	go func() {
		defer ioWg.Done()
		buf := make([]byte, 4096)
		for {
			n, readErr := session.Stdout.Read(buf)
			if n > 0 {
				chunk := make([]byte, n)
				copy(chunk, buf[:n])
				_ = sendMsg(&computer_apiv1.ExecuteStreamResponse{
					Output: &computer_apiv1.ExecuteStreamResponse_Stdout{
						Stdout: chunk,
					},
				})
			}
			if readErr != nil {
				break
			}
		}
	}()

	// stderr forwarder
	ioWg.Add(1)
	go func() {
		defer ioWg.Done()
		buf := make([]byte, 4096)
		for {
			n, readErr := session.Stderr.Read(buf)
			if n > 0 {
				chunk := make([]byte, n)
				copy(chunk, buf[:n])
				_ = sendMsg(&computer_apiv1.ExecuteStreamResponse{
					Output: &computer_apiv1.ExecuteStreamResponse_Stderr{
						Stderr: chunk,
					},
				})
			}
			if readErr != nil {
				break
			}
		}
	}()

	// 6. Forward stdin from client to the process
	go func() {
		defer session.Stdin.Close()
		for {
			msg, recvErr := stream.Receive()
			if recvErr != nil {
				// Client disconnected or stream ended
				return
			}

			switch input := msg.GetInput().(type) {
			case *computer_apiv1.ExecuteStreamRequest_Stdin:
				_, _ = session.Stdin.Write(input.Stdin)
			case *computer_apiv1.ExecuteStreamRequest_CloseStdin:
				if input.CloseStdin {
					return
				}
			case *computer_apiv1.ExecuteStreamRequest_Config:
				// Ignore duplicate config messages
			}
		}
	}()

	// 7. Wait for the process to exit
	exitCode, waitErr := session.Wait()

	// Wait for stdout/stderr forwarding to complete
	ioWg.Wait()

	// 8. Send exit code or error
	if waitErr != nil {
		_ = sendMsg(&computer_apiv1.ExecuteStreamResponse{
			Output: &computer_apiv1.ExecuteStreamResponse_ErrorMessage{
				ErrorMessage: waitErr.Error(),
			},
		})
	} else {
		_ = sendMsg(&computer_apiv1.ExecuteStreamResponse{
			Output: &computer_apiv1.ExecuteStreamResponse_ExitCode{
				ExitCode: int32(exitCode),
			},
		})
	}

	return nil
}

func (s *BasicComputerService) ReadFile(
	ctx context.Context,
	req *connect.Request[computer_apiv1.ReadFileRequest],
) (*connect.Response[computer_apiv1.ReadFileResponse], error) {
	comp, err := s.provider.GetComputer(ctx, req.Msg.GetSessionId())
	if err != nil {
		return connect.NewResponse(&computer_apiv1.ReadFileResponse{
			Result: &computer_apiv1.ReadFileResponse_ErrorMessage{
				ErrorMessage: err.Error(),
			},
		}), nil
	}

	data, err := comp.ReadFile(ctx, req.Msg.GetPath())
	if err != nil {
		return connect.NewResponse(&computer_apiv1.ReadFileResponse{
			Result: &computer_apiv1.ReadFileResponse_ErrorMessage{
				ErrorMessage: err.Error(),
			},
		}), nil
	}

	if req.Msg.Offset != nil || req.Msg.Limit != nil {
		offset := int64(0)
		if req.Msg.Offset != nil {
			offset = req.Msg.GetOffset()
		}
		if offset < 0 {
			offset = 0
		}
		if offset > int64(len(data)) {
			offset = int64(len(data))
		}

		end := int64(len(data))
		if req.Msg.Limit != nil {
			end = offset + int64(req.Msg.GetLimit())
			if end > int64(len(data)) {
				end = int64(len(data))
			}
		}
		data = data[offset:end]
	}

	return connect.NewResponse(&computer_apiv1.ReadFileResponse{
		Result: &computer_apiv1.ReadFileResponse_Content{
			Content: data,
		},
	}), nil
}

func (s *BasicComputerService) WriteFile(
	ctx context.Context,
	req *connect.Request[computer_apiv1.WriteFileRequest],
) (*connect.Response[computer_apiv1.WriteFileResponse], error) {
	comp, err := s.provider.GetComputer(ctx, req.Msg.GetSessionId())
	if err != nil {
		return connect.NewResponse(&computer_apiv1.WriteFileResponse{
			Result: &computer_apiv1.WriteFileResponse_ErrorMessage{
				ErrorMessage: err.Error(),
			},
		}), nil
	}

	contentToWrite := req.Msg.GetContent()
	if req.Msg.GetAppend() {
		existingContent, err := comp.ReadFile(ctx, req.Msg.GetPath())
		if err == nil {
			contentToWrite = append(existingContent, contentToWrite...)
		}
	}

	err = comp.WriteFile(ctx, req.Msg.GetPath(), contentToWrite)
	if err != nil {
		return connect.NewResponse(&computer_apiv1.WriteFileResponse{
			Result: &computer_apiv1.WriteFileResponse_ErrorMessage{
				ErrorMessage: err.Error(),
			},
		}), nil
	}

	return connect.NewResponse(&computer_apiv1.WriteFileResponse{
		Result: &computer_apiv1.WriteFileResponse_Resp{
			Resp: &computer_apiv1.SuccessWriteResponse{},
		},
	}), nil
}

func (s *BasicComputerService) ListDirectory(
	ctx context.Context,
	req *connect.Request[computer_apiv1.ListDirectoryRequest],
) (*connect.Response[computer_apiv1.ListDirectoryResponse], error) {
	comp, err := s.provider.GetComputer(ctx, req.Msg.GetSessionId())
	if err != nil {
		return connect.NewResponse(&computer_apiv1.ListDirectoryResponse{
			Result: &computer_apiv1.ListDirectoryResponse_ErrorMessage{
				ErrorMessage: err.Error(),
			},
		}), nil
	}

	filesInfo, err := comp.ListDirectory(ctx, req.Msg.GetPath())
	if err != nil {
		return connect.NewResponse(&computer_apiv1.ListDirectoryResponse{
			Result: &computer_apiv1.ListDirectoryResponse_ErrorMessage{
				ErrorMessage: err.Error(),
			},
		}), nil
	}

	fileList := make([]string, len(filesInfo))
	for i, f := range filesInfo {
		fileList[i] = f.Name
	}

	return connect.NewResponse(&computer_apiv1.ListDirectoryResponse{
		Result: &computer_apiv1.ListDirectoryResponse_Response{
			Response: &computer_apiv1.SuccessListDirectoryResponse{
				Files: fileList,
			},
		},
	}), nil
}

func (s *BasicComputerService) GetUserId(
	ctx context.Context,
	req *connect.Request[computer_apiv1.GetUserIdRequest],
) (*connect.Response[computer_apiv1.GetUserIdResponse], error) {
	comp, err := s.provider.GetComputer(ctx, req.Msg.GetSessionId())
	if err != nil {
		return connect.NewResponse(&computer_apiv1.GetUserIdResponse{
			Result: &computer_apiv1.GetUserIdResponse_ErrorMessage{
				ErrorMessage: err.Error(),
			},
		}), nil
	}

	uid, err := comp.GetUserId()
	if err != nil {
		return connect.NewResponse(&computer_apiv1.GetUserIdResponse{
			Result: &computer_apiv1.GetUserIdResponse_ErrorMessage{
				ErrorMessage: err.Error(),
			},
		}), nil
	}

	return connect.NewResponse(&computer_apiv1.GetUserIdResponse{
		Result: &computer_apiv1.GetUserIdResponse_UserId{
			UserId: uid,
		},
	}), nil
}

func (s *BasicComputerService) GetGroupId(
	ctx context.Context,
	req *connect.Request[computer_apiv1.GetGroupIdRequest],
) (*connect.Response[computer_apiv1.GetGroupIdResponse], error) {
	comp, err := s.provider.GetComputer(ctx, req.Msg.GetSessionId())
	if err != nil {
		return connect.NewResponse(&computer_apiv1.GetGroupIdResponse{
			Result: &computer_apiv1.GetGroupIdResponse_ErrorMessage{
				ErrorMessage: err.Error(),
			},
		}), nil
	}

	gid, err := comp.GetGroupId()
	if err != nil {
		return connect.NewResponse(&computer_apiv1.GetGroupIdResponse{
			Result: &computer_apiv1.GetGroupIdResponse_ErrorMessage{
				ErrorMessage: err.Error(),
			},
		}), nil
	}

	return connect.NewResponse(&computer_apiv1.GetGroupIdResponse{
		Result: &computer_apiv1.GetGroupIdResponse_GroupId{
			GroupId: gid,
		},
	}), nil
}

func CreateBasicComputerServiceHandler(mux *http.ServeMux, provider computer.IComputerProvider) {
	svc := &BasicComputerService{provider: provider}
	path, handler := computer_apiv1connect.NewBasicComputerServiceHandler(
		svc,
		connect.WithInterceptors(validate.NewInterceptor()),
	)
	mux.Handle(path, handler)
}
