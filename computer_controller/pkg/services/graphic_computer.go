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

type GraphicComputerService struct {
	provider computer.IComputerProvider
}

func (s *GraphicComputerService) getGraphicalComputer(ctx context.Context, sessionID string) (computer.IGraphicalComputer, error) {
	comp, err := s.provider.GetComputer(ctx, sessionID)
	if err != nil {
		return nil, err
	}
	return computer.GetGraphicalComputer(comp)
}

func (s *GraphicComputerService) CaptureScreenshot(
	ctx context.Context,
	req *connect.Request[computer_apiv1.CaptureScreenshotRequest],
) (*connect.Response[computer_apiv1.CaptureScreenshotResponse], error) {
	gc, err := s.getGraphicalComputer(ctx, req.Msg.GetSessionId())
	if err != nil {
		return connect.NewResponse(&computer_apiv1.CaptureScreenshotResponse{
			Result: &computer_apiv1.CaptureScreenshotResponse_ErrorMessage{
				ErrorMessage: err.Error(),
			},
		}), nil
	}

	imgData, err := gc.CaptureScreenshot(ctx)
	if err != nil {
		return connect.NewResponse(&computer_apiv1.CaptureScreenshotResponse{
			Result: &computer_apiv1.CaptureScreenshotResponse_ErrorMessage{
				ErrorMessage: err.Error(),
			},
		}), nil
	}

	return connect.NewResponse(&computer_apiv1.CaptureScreenshotResponse{
		Result: &computer_apiv1.CaptureScreenshotResponse_Response{
			Response: &computer_apiv1.SuccessCaptureScreenshotResponse{
				ImageData: imgData,
			},
		},
	}), nil
}

func (s *GraphicComputerService) Click(
	ctx context.Context,
	req *connect.Request[computer_apiv1.ClickRequest],
) (*connect.Response[computer_apiv1.ClickResponse], error) {
	gc, err := s.getGraphicalComputer(ctx, req.Msg.GetSessionId())
	if err != nil {
		return connect.NewResponse(&computer_apiv1.ClickResponse{
			Result: &computer_apiv1.ClickResponse_ErrorMessage{
				ErrorMessage: err.Error(),
			},
		}), nil
	}

	btn := "left"
	if req.Msg.Button != nil && req.Msg.GetButton() != "" {
		btn = req.Msg.GetButton()
	}

	err = gc.Click(ctx, int(req.Msg.GetX()), int(req.Msg.GetY()), btn)
	if err != nil {
		return connect.NewResponse(&computer_apiv1.ClickResponse{
			Result: &computer_apiv1.ClickResponse_ErrorMessage{
				ErrorMessage: err.Error(),
			},
		}), nil
	}

	return connect.NewResponse(&computer_apiv1.ClickResponse{
		Result: &computer_apiv1.ClickResponse_Response{
			Response: &computer_apiv1.SuccessClickResponse{},
		},
	}), nil
}

func (s *GraphicComputerService) Type(
	ctx context.Context,
	req *connect.Request[computer_apiv1.TypeRequest],
) (*connect.Response[computer_apiv1.TypeResponse], error) {
	gc, err := s.getGraphicalComputer(ctx, req.Msg.GetSessionId())
	if err != nil {
		return connect.NewResponse(&computer_apiv1.TypeResponse{
			Result: &computer_apiv1.TypeResponse_ErrorMessage{
				ErrorMessage: err.Error(),
			},
		}), nil
	}

	err = gc.Type(ctx, req.Msg.GetText())
	if err != nil {
		return connect.NewResponse(&computer_apiv1.TypeResponse{
			Result: &computer_apiv1.TypeResponse_ErrorMessage{
				ErrorMessage: err.Error(),
			},
		}), nil
	}

	return connect.NewResponse(&computer_apiv1.TypeResponse{
		Result: &computer_apiv1.TypeResponse_Response{
			Response: &computer_apiv1.SuccessTypeResponse{},
		},
	}), nil
}

func (s *GraphicComputerService) PressKey(
	ctx context.Context,
	req *connect.Request[computer_apiv1.PressKeyRequest],
) (*connect.Response[computer_apiv1.PressKeyResponse], error) {
	gc, err := s.getGraphicalComputer(ctx, req.Msg.GetSessionId())
	if err != nil {
		return connect.NewResponse(&computer_apiv1.PressKeyResponse{
			Result: &computer_apiv1.PressKeyResponse_ErrorMessage{
				ErrorMessage: err.Error(),
			},
		}), nil
	}

	err = gc.PressKey(ctx, req.Msg.GetKey())
	if err != nil {
		return connect.NewResponse(&computer_apiv1.PressKeyResponse{
			Result: &computer_apiv1.PressKeyResponse_ErrorMessage{
				ErrorMessage: err.Error(),
			},
		}), nil
	}

	return connect.NewResponse(&computer_apiv1.PressKeyResponse{
		Result: &computer_apiv1.PressKeyResponse_Response{
			Response: &computer_apiv1.SuccessPressKeyResponse{},
		},
	}), nil
}

func (s *GraphicComputerService) ReleaseKey(
	ctx context.Context,
	req *connect.Request[computer_apiv1.ReleaseKeyRequest],
) (*connect.Response[computer_apiv1.ReleaseKeyResponse], error) {
	gc, err := s.getGraphicalComputer(ctx, req.Msg.GetSessionId())
	if err != nil {
		return connect.NewResponse(&computer_apiv1.ReleaseKeyResponse{
			Result: &computer_apiv1.ReleaseKeyResponse_ErrorMessage{
				ErrorMessage: err.Error(),
			},
		}), nil
	}

	err = gc.ReleaseKey(ctx, req.Msg.GetKey())
	if err != nil {
		return connect.NewResponse(&computer_apiv1.ReleaseKeyResponse{
			Result: &computer_apiv1.ReleaseKeyResponse_ErrorMessage{
				ErrorMessage: err.Error(),
			},
		}), nil
	}

	return connect.NewResponse(&computer_apiv1.ReleaseKeyResponse{
		Result: &computer_apiv1.ReleaseKeyResponse_Response{
			Response: &computer_apiv1.SuccessReleaseKeyResponse{},
		},
	}), nil
}

func (s *GraphicComputerService) PressAndHoldKey(
	ctx context.Context,
	req *connect.Request[computer_apiv1.PressAndHoldKeyRequest],
) (*connect.Response[computer_apiv1.PressAndHoldKeyResponse], error) {
	gc, err := s.getGraphicalComputer(ctx, req.Msg.GetSessionId())
	if err != nil {
		return connect.NewResponse(&computer_apiv1.PressAndHoldKeyResponse{
			Result: &computer_apiv1.PressAndHoldKeyResponse_ErrorMessage{
				ErrorMessage: err.Error(),
			},
		}), nil
	}

	err = gc.PressAndHoldKey(ctx, req.Msg.GetKey())
	if err != nil {
		return connect.NewResponse(&computer_apiv1.PressAndHoldKeyResponse{
			Result: &computer_apiv1.PressAndHoldKeyResponse_ErrorMessage{
				ErrorMessage: err.Error(),
			},
		}), nil
	}

	return connect.NewResponse(&computer_apiv1.PressAndHoldKeyResponse{
		Result: &computer_apiv1.PressAndHoldKeyResponse_Response{
			Response: &computer_apiv1.SuccessPressAndHoldKeyResponse{},
		},
	}), nil
}

func (s *GraphicComputerService) ReleaseAllKeys(
	ctx context.Context,
	req *connect.Request[computer_apiv1.ReleaseAllKeysRequest],
) (*connect.Response[computer_apiv1.ReleaseAllKeysResponse], error) {
	gc, err := s.getGraphicalComputer(ctx, req.Msg.GetSessionId())
	if err != nil {
		return connect.NewResponse(&computer_apiv1.ReleaseAllKeysResponse{
			Result: &computer_apiv1.ReleaseAllKeysResponse_ErrorMessage{
				ErrorMessage: err.Error(),
			},
		}), nil
	}

	err = gc.ReleaseAllKeys(ctx)
	if err != nil {
		return connect.NewResponse(&computer_apiv1.ReleaseAllKeysResponse{
			Result: &computer_apiv1.ReleaseAllKeysResponse_ErrorMessage{
				ErrorMessage: err.Error(),
			},
		}), nil
	}

	return connect.NewResponse(&computer_apiv1.ReleaseAllKeysResponse{
		Result: &computer_apiv1.ReleaseAllKeysResponse_Response{
			Response: &computer_apiv1.SuccessReleaseAllKeysResponse{},
		},
	}), nil
}

func (s *GraphicComputerService) Drag(
	ctx context.Context,
	req *connect.Request[computer_apiv1.DragRequest],
) (*connect.Response[computer_apiv1.DragResponse], error) {
	gc, err := s.getGraphicalComputer(ctx, req.Msg.GetSessionId())
	if err != nil {
		return connect.NewResponse(&computer_apiv1.DragResponse{
			Result: &computer_apiv1.DragResponse_ErrorMessage{
				ErrorMessage: err.Error(),
			},
		}), nil
	}

	err = gc.Drag(ctx, int(req.Msg.GetX1()), int(req.Msg.GetY1()), int(req.Msg.GetX2()), int(req.Msg.GetY2()))
	if err != nil {
		return connect.NewResponse(&computer_apiv1.DragResponse{
			Result: &computer_apiv1.DragResponse_ErrorMessage{
				ErrorMessage: err.Error(),
			},
		}), nil
	}

	return connect.NewResponse(&computer_apiv1.DragResponse{
		Result: &computer_apiv1.DragResponse_Response{
			Response: &computer_apiv1.SuccessDragResponse{},
		},
	}), nil
}

func (s *GraphicComputerService) MoveMouseTo(
	ctx context.Context,
	req *connect.Request[computer_apiv1.MoveMouseToRequest],
) (*connect.Response[computer_apiv1.MoveMouseToResponse], error) {
	gc, err := s.getGraphicalComputer(ctx, req.Msg.GetSessionId())
	if err != nil {
		return connect.NewResponse(&computer_apiv1.MoveMouseToResponse{
			Result: &computer_apiv1.MoveMouseToResponse_ErrorMessage{
				ErrorMessage: err.Error(),
			},
		}), nil
	}

	err = gc.MoveMouseTo(ctx, int(req.Msg.GetX()), int(req.Msg.GetY()))
	if err != nil {
		return connect.NewResponse(&computer_apiv1.MoveMouseToResponse{
			Result: &computer_apiv1.MoveMouseToResponse_ErrorMessage{
				ErrorMessage: err.Error(),
			},
		}), nil
	}

	return connect.NewResponse(&computer_apiv1.MoveMouseToResponse{
		Result: &computer_apiv1.MoveMouseToResponse_Response{
			Response: &computer_apiv1.SuccessMoveMouseToResponse{},
		},
	}), nil
}

func (s *GraphicComputerService) Scroll(
	ctx context.Context,
	req *connect.Request[computer_apiv1.ScrollRequest],
) (*connect.Response[computer_apiv1.ScrollResponse], error) {
	gc, err := s.getGraphicalComputer(ctx, req.Msg.GetSessionId())
	if err != nil {
		return connect.NewResponse(&computer_apiv1.ScrollResponse{
			Result: &computer_apiv1.ScrollResponse_ErrorMessage{
				ErrorMessage: err.Error(),
			},
		}), nil
	}

	err = gc.Scroll(ctx, int(req.Msg.GetDx()), int(req.Msg.GetDy()))
	if err != nil {
		return connect.NewResponse(&computer_apiv1.ScrollResponse{
			Result: &computer_apiv1.ScrollResponse_ErrorMessage{
				ErrorMessage: err.Error(),
			},
		}), nil
	}

	return connect.NewResponse(&computer_apiv1.ScrollResponse{
		Result: &computer_apiv1.ScrollResponse_Response{
			Response: &computer_apiv1.SuccessScrollResponse{},
		},
	}), nil
}

func (s *GraphicComputerService) GetClipboard(
	ctx context.Context,
	req *connect.Request[computer_apiv1.GetClipboardRequest],
) (*connect.Response[computer_apiv1.GetClipboardResponse], error) {
	gc, err := s.getGraphicalComputer(ctx, req.Msg.GetSessionId())
	if err != nil {
		return connect.NewResponse(&computer_apiv1.GetClipboardResponse{
			Result: &computer_apiv1.GetClipboardResponse_ErrorMessage{
				ErrorMessage: err.Error(),
			},
		}), nil
	}

	text, err := gc.GetClipboard(ctx)
	if err != nil {
		return connect.NewResponse(&computer_apiv1.GetClipboardResponse{
			Result: &computer_apiv1.GetClipboardResponse_ErrorMessage{
				ErrorMessage: err.Error(),
			},
		}), nil
	}

	return connect.NewResponse(&computer_apiv1.GetClipboardResponse{
		Result: &computer_apiv1.GetClipboardResponse_Text{
			Text: text,
		},
	}), nil
}

func (s *GraphicComputerService) SetClipboard(
	ctx context.Context,
	req *connect.Request[computer_apiv1.SetClipboardRequest],
) (*connect.Response[computer_apiv1.SetClipboardResponse], error) {
	gc, err := s.getGraphicalComputer(ctx, req.Msg.GetSessionId())
	if err != nil {
		return connect.NewResponse(&computer_apiv1.SetClipboardResponse{
			Result: &computer_apiv1.SetClipboardResponse_ErrorMessage{
				ErrorMessage: err.Error(),
			},
		}), nil
	}

	err = gc.SetClipboard(ctx, req.Msg.GetText())
	if err != nil {
		return connect.NewResponse(&computer_apiv1.SetClipboardResponse{
			Result: &computer_apiv1.SetClipboardResponse_ErrorMessage{
				ErrorMessage: err.Error(),
			},
		}), nil
	}

	return connect.NewResponse(&computer_apiv1.SetClipboardResponse{
		Result: &computer_apiv1.SetClipboardResponse_Response{
			Response: &computer_apiv1.SuccessSetClipboardResponse{},
		},
	}), nil
}

func (s *GraphicComputerService) GetScreenSize(
	ctx context.Context,
	req *connect.Request[computer_apiv1.GetScreenSizeRequest],
) (*connect.Response[computer_apiv1.GetScreenSizeResponse], error) {
	gc, err := s.getGraphicalComputer(ctx, req.Msg.GetSessionId())
	if err != nil {
		return connect.NewResponse(&computer_apiv1.GetScreenSizeResponse{
			Result: &computer_apiv1.GetScreenSizeResponse_ErrorMessage{
				ErrorMessage: err.Error(),
			},
		}), nil
	}

	w, h, err := gc.GetScreenSize(ctx)
	if err != nil {
		return connect.NewResponse(&computer_apiv1.GetScreenSizeResponse{
			Result: &computer_apiv1.GetScreenSizeResponse_ErrorMessage{
				ErrorMessage: err.Error(),
			},
		}), nil
	}

	return connect.NewResponse(&computer_apiv1.GetScreenSizeResponse{
		Result: &computer_apiv1.GetScreenSizeResponse_Response{
			Response: &computer_apiv1.ScreenSize{
				Width:  int32(w),
				Height: int32(h),
			},
		},
	}), nil
}

func CreateGraphicComputerServiceHandler(mux *http.ServeMux) {
	provider := computer.GetComputerProvider()
	svc := &GraphicComputerService{provider: provider}
	path, handler := computer_apiv1connect.NewGraphicalComputerServiceHandler(
		svc,
		connect.WithInterceptors(validate.NewInterceptor()),
	)
	mux.Handle(path, handler)
}
