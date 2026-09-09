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

type ComputerProviderService struct {
	provider computer.IComputerProvider
}

func toComputerConfig(req *computer_apiv1.CreateComputerRequest) computer.ComputerConfig {
	var resources *computer.ComputerResourceConfig
	if req.GetResources() != nil {
		resources = &computer.ComputerResourceConfig{
			CPU:    req.GetResources().GetCpu(),
			Memory: req.GetResources().GetMemory(),
		}
	}

	return computer.ComputerConfig{
		Image:       req.GetImage(),
		Resources:   resources,
		Environment: req.GetEnvironment(),
	}
}

func (s *ComputerProviderService) CreateComputer(
	ctx context.Context,
	req *connect.Request[computer_apiv1.CreateComputerRequest],
) (*connect.Response[computer_apiv1.CreateComputerResponse], error) {
	sessionID, err := s.provider.CreateComputer(ctx, toComputerConfig(req.Msg))
	if err != nil {
		return connect.NewResponse(&computer_apiv1.CreateComputerResponse{
			Result: &computer_apiv1.CreateComputerResponse_ErrorMessage{
				ErrorMessage: err.Error(),
			},
		}), nil
	}

	return connect.NewResponse(&computer_apiv1.CreateComputerResponse{
		Result: &computer_apiv1.CreateComputerResponse_SessionId{
			SessionId: sessionID,
		},
	}), nil
}

func (s *ComputerProviderService) GetComputerInfo(
	ctx context.Context,
	req *connect.Request[computer_apiv1.GetComputerInfoRequest],
) (*connect.Response[computer_apiv1.GetComputerInfoResponse], error) {
	comp, err := s.provider.GetComputer(ctx, req.Msg.GetSessionId())
	if err != nil {
		return connect.NewResponse(&computer_apiv1.GetComputerInfoResponse{
			Type: computer_apiv1.ComputerType_COMPUTER_TYPE_UNSPECIFIED,
		}), nil
	}

	compType := computer_apiv1.ComputerType_COMPUTER_TYPE_HEADLESS
	if _, err := computer.GetGraphicalComputer(comp); err == nil {
		compType = computer_apiv1.ComputerType_COMPUTER_TYPE_GRAPHICAL
	}

	return connect.NewResponse(&computer_apiv1.GetComputerInfoResponse{
		Type: compType,
	}), nil
}

func (s *ComputerProviderService) DeleteComputer(
	ctx context.Context,
	req *connect.Request[computer_apiv1.DeleteComputerRequest],
) (*connect.Response[computer_apiv1.DeleteComputerResponse], error) {
	_ = s.provider.DeleteComputer(ctx, req.Msg.GetSessionId())
	return connect.NewResponse(&computer_apiv1.DeleteComputerResponse{}), nil
}

func CreateComputerProviderServiceHandler(mux *http.ServeMux, provider computer.IComputerProvider) {
	svc := &ComputerProviderService{provider: provider}
	path, handler := computer_apiv1connect.NewComputerProviderServiceHandler(
		svc,
		connect.WithInterceptors(validate.NewInterceptor()),
	)
	mux.Handle(path, handler)
}
