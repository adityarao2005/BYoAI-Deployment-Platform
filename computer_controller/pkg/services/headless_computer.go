package services

import (
	"context"
	"net/http"

	"connectrpc.com/connect"
	"connectrpc.com/validate"

	computer_apiv1 "github.com/adityarao2005/BYoAI-Deployment-Platform/computer_controller/gen/computer_api/v1"
	"github.com/adityarao2005/BYoAI-Deployment-Platform/computer_controller/gen/computer_api/v1/computer_apiv1connect"
	"github.com/adityarao2005/BYoAI-Deployment-Platform/computer_controller/pkg/computer"
)

type BasicComputerService struct {
	provider computer.IComputerProvider
}

func (s *BasicComputerService) Execute(
	ctx context.Context,
	req *connect.Request[computer_apiv1.ExecuteRequest],
) (*connect.Response[computer_apiv1.ExecuteResponse], error) {
	comp, err := s.provider.GetComputer(ctx, req.Msg.GetSessionId())
	if err != nil {
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

func CreateBasicComputerServiceHandler(mux *http.ServeMux) {
	provider := computer.GetComputerProvider()
	svc := &BasicComputerService{provider: provider}
	path, handler := computer_apiv1connect.NewBasicComputerServiceHandler(
		svc,
		connect.WithInterceptors(validate.NewInterceptor()),
	)
	mux.Handle(path, handler)
}