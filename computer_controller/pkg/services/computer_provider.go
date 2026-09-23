package services

import (
	"archive/zip"
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"connectrpc.com/connect"
	"connectrpc.com/validate"

	computer_apiv1 "github.com/adityarao2005/BYoAI-Deployment-Platform/computer_controller/gen/computer_api/v1"
	"github.com/adityarao2005/BYoAI-Deployment-Platform/computer_controller/gen/computer_api/v1/computer_apiv1connect"
	"github.com/adityarao2005/BYoAI-Deployment-Platform/computer_controller/pkg/computer"
	"github.com/adityarao2005/BYoAI-Deployment-Platform/computer_controller/pkg/logger"
)

type ComputerProviderService struct {
	provider     computer.IComputerProvider
	workspaceDir string
}

func extractZip(zipBytes []byte, targetDir string) error {
	zipReader, err := zip.NewReader(bytes.NewReader(zipBytes), int64(len(zipBytes)))
	if err != nil {
		return fmt.Errorf("failed to open zip reader: %w", err)
	}

	for _, file := range zipReader.File {
		cleanPath := filepath.Clean(file.Name)
		if strings.HasPrefix(cleanPath, "..") || filepath.IsAbs(cleanPath) {
			continue
		}

		filePath := filepath.Join(targetDir, cleanPath)
		if file.FileInfo().IsDir() {
			if err := os.MkdirAll(filePath, 0755); err != nil {
				return fmt.Errorf("failed to create directory %s: %w", filePath, err)
			}
			continue
		}

		if err := os.MkdirAll(filepath.Dir(filePath), 0755); err != nil {
			return fmt.Errorf("failed to create parent directory for %s: %w", filePath, err)
		}

		srcFile, err := file.Open()
		if err != nil {
			return fmt.Errorf("failed to open zip entry %s: %w", file.Name, err)
		}

		dstFile, err := os.OpenFile(filePath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, file.Mode())
		if err != nil {
			srcFile.Close()
			return fmt.Errorf("failed to create file %s: %w", filePath, err)
		}

		_, err = io.Copy(dstFile, srcFile)
		srcFile.Close()
		dstFile.Close()
		if err != nil {
			return fmt.Errorf("failed to write file %s: %w", filePath, err)
		}
	}
	return nil
}

func toComputerConfig(req *computer_apiv1.CreateComputerRequest) computer.ComputerConfig {
	var resources *computer.ComputerResourceConfig
	if req.GetResources() != nil {
		resources = &computer.ComputerResourceConfig{
			CPU:    req.GetResources().GetCpu(),
			Memory: req.GetResources().GetMemory(),
		}
	}

	var networkRules *computer.NetworkRules
	if req.GetNetworkRules() != nil {
		networkRules = &computer.NetworkRules{
			AllowedHosts: req.GetNetworkRules().GetAllowedHosts(),
			DeniedHosts:  req.GetNetworkRules().GetDeniedHosts(),
		}
	}

	return computer.ComputerConfig{
		Image:        req.GetImage(),
		Resources:    resources,
		Environment:  req.GetEnvironment(),
		NetworkRules: networkRules,
	}
}

func (s *ComputerProviderService) CreateComputer(
	ctx context.Context,
	req *connect.Request[computer_apiv1.CreateComputerRequest],
) (*connect.Response[computer_apiv1.CreateComputerResponse], error) {
	logger.Info("CreateComputer RPC called", "image", req.Msg.GetImage())

	sessionID, err := s.provider.CreateComputer(ctx, toComputerConfig(req.Msg))
	if err != nil {
		logger.Error("CreateComputer RPC failed", "image", req.Msg.GetImage(), "error", err)
		return connect.NewResponse(&computer_apiv1.CreateComputerResponse{
			Result: &computer_apiv1.CreateComputerResponse_ErrorMessage{
				ErrorMessage: err.Error(),
			},
		}), nil
	}

	logger.Info("CreateComputer RPC completed successfully", "sessionID", sessionID)
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
	sessionID := req.Msg.GetSessionId()
	logger.Info("GetComputerInfo RPC called", "sessionID", sessionID)

	comp, err := s.provider.GetComputer(ctx, sessionID)
	if err != nil {
		logger.Warn("GetComputerInfo RPC failed to locate computer", "sessionID", sessionID, "error", err)
		return connect.NewResponse(&computer_apiv1.GetComputerInfoResponse{
			Type: computer_apiv1.ComputerType_COMPUTER_TYPE_UNSPECIFIED,
		}), nil
	}

	compType := computer_apiv1.ComputerType_COMPUTER_TYPE_HEADLESS
	if _, err := computer.GetGraphicalComputer(comp); err == nil {
		compType = computer_apiv1.ComputerType_COMPUTER_TYPE_GRAPHICAL
	}

	logger.Info("GetComputerInfo RPC completed", "sessionID", sessionID, "type", compType.String())
	return connect.NewResponse(&computer_apiv1.GetComputerInfoResponse{
		Type: compType,
	}), nil
}

func (s *ComputerProviderService) DeleteComputer(
	ctx context.Context,
	req *connect.Request[computer_apiv1.DeleteComputerRequest],
) (*connect.Response[computer_apiv1.DeleteComputerResponse], error) {
	sessionID := req.Msg.GetSessionId()
	logger.Info("DeleteComputer RPC called", "sessionID", sessionID)

	err := s.provider.DeleteComputer(ctx, sessionID)
	if err != nil {
		logger.Error("DeleteComputer RPC failed", "sessionID", sessionID, "error", err)
	} else {
		logger.Info("DeleteComputer RPC completed successfully", "sessionID", sessionID)
	}

	return connect.NewResponse(&computer_apiv1.DeleteComputerResponse{}), nil
}

func (s *ComputerProviderService) SendSkillsZip(
	ctx context.Context,
	stream *connect.ClientStream[computer_apiv1.SendSkillsZipRequest],
) (*connect.Response[computer_apiv1.SendSkillsZipResponse], error) {
	logger.Info("SendSkillsZip RPC called")

	var sessionID string
	var zipBuf bytes.Buffer

	for stream.Receive() {
		msg := stream.Msg()
		if sessionID == "" {
			sessionID = msg.GetSessionId()
		}
		if len(msg.GetChunk()) > 0 {
			zipBuf.Write(msg.GetChunk())
		}
	}

	if err := stream.Err(); err != nil {
		logger.Error("SendSkillsZip stream receiving failed", "error", err)
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}

	if sessionID == "" {
		return connect.NewResponse(&computer_apiv1.SendSkillsZipResponse{
			Result: &computer_apiv1.SendSkillsZipResponse_ErrorMessage{
				ErrorMessage: "session_id is required",
			},
		}), nil
	}

	comp, err := s.provider.GetComputer(ctx, sessionID)
	if err != nil {
		logger.Error("SendSkillsZip RPC failed to locate computer", "sessionID", sessionID, "error", err)
		return connect.NewResponse(&computer_apiv1.SendSkillsZipResponse{
			Result: &computer_apiv1.SendSkillsZipResponse_ErrorMessage{
				ErrorMessage: fmt.Sprintf("computer session not found: %s", sessionID),
			},
		}), nil
	}
	_ = comp

	workspaceDir := s.workspaceDir
	if workspaceDir == "" {
		workspaceDir = "/workspace"
	}

	skillsPath := filepath.Join(workspaceDir, sessionID, "skills")
	if err := os.MkdirAll(skillsPath, 0755); err != nil {
		logger.Error("SendSkillsZip failed to create skills target directory", "path", skillsPath, "error", err)
		return connect.NewResponse(&computer_apiv1.SendSkillsZipResponse{
			Result: &computer_apiv1.SendSkillsZipResponse_ErrorMessage{
				ErrorMessage: fmt.Sprintf("failed to create target skills directory: %v", err),
			},
		}), nil
	}

	if zipBuf.Len() > 0 {
		if err := extractZip(zipBuf.Bytes(), skillsPath); err != nil {
			logger.Error("SendSkillsZip failed to extract skills zip", "sessionID", sessionID, "error", err)
			return connect.NewResponse(&computer_apiv1.SendSkillsZipResponse{
				Result: &computer_apiv1.SendSkillsZipResponse_ErrorMessage{
					ErrorMessage: fmt.Sprintf("failed to extract zip: %v", err),
				},
			}), nil
		}
	}

	logger.Info("SendSkillsZip completed successfully", "sessionID", sessionID, "skillsPath", skillsPath)
	return connect.NewResponse(&computer_apiv1.SendSkillsZipResponse{
		Result: &computer_apiv1.SendSkillsZipResponse_SkillsPath{
			SkillsPath: skillsPath,
		},
	}), nil
}

func CreateComputerProviderServiceHandler(mux *http.ServeMux, provider computer.IComputerProvider, workspaceDir ...string) {
	wsDir := "/workspace"
	if len(workspaceDir) > 0 && workspaceDir[0] != "" {
		wsDir = workspaceDir[0]
	}
	svc := &ComputerProviderService{provider: provider, workspaceDir: wsDir}
	path, handler := computer_apiv1connect.NewComputerProviderServiceHandler(
		svc,
		connect.WithInterceptors(validate.NewInterceptor()),
	)
	mux.Handle(path, handler)
}
