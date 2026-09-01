package server

import (
	"log"
	"net/http"

	"github.com/adityarao2005/BYoAI-Deployment-Platform/computer_controller/pkg/computer"
	"github.com/adityarao2005/BYoAI-Deployment-Platform/computer_controller/pkg/config"
	"github.com/adityarao2005/BYoAI-Deployment-Platform/computer_controller/pkg/services"
)

func NewServerHandler(server_config *config.ServerConfig) (http.Handler, error) {
	mux := http.NewServeMux()

	computer_provider, err := computer.GetComputerProvider(server_config)
	if err != nil {
		return nil, err
	}

	services.CreateComputerProviderServiceHandler(mux, computer_provider)
	services.CreateBasicComputerServiceHandler(mux, computer_provider)
	services.CreateGraphicComputerServiceHandler(mux, computer_provider)

	return mux, nil
}

func RunServer() {
	server_config, err := config.LoadConfigFromFile()
	if err != nil {
		log.Fatalf("unable to load computer.yaml: %v", err)
	}

	handler, err := NewServerHandler(server_config)
	if err != nil {
		log.Fatalf("unable to create computer provider: %v", err)
	}

	protocols := new(http.Protocols)

	// TODO: make a way to allow encrypted HTTP 2 by passing in TLS certs
	protocols.SetHTTP1(true)
	protocols.SetUnencryptedHTTP2(true)

	server := http.Server{
		Addr:      server_config.Server.Address(),
		Handler:   handler,
		Protocols: protocols,
	}

	server.ListenAndServe()
}
