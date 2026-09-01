package server

import (
	"log"
	"net/http"

	"github.com/adityarao2005/BYoAI-Deployment-Platform/computer_controller/pkg/computer"
	"github.com/adityarao2005/BYoAI-Deployment-Platform/computer_controller/pkg/config"
	"github.com/adityarao2005/BYoAI-Deployment-Platform/computer_controller/pkg/services"
)

func RunServer() {
	mux := http.NewServeMux()

	server_config, err := config.LoadConfigFromFile()

	if err != nil {
		log.Fatalf("unable to load computer.yaml: %v", err)
	}

	// create the computer provider and load into services
	computer_provider, err := computer.GetComputerProvider(server_config)

	if err != nil {
		log.Fatalf("unable to create computer provider: %v", err)
	}

	services.CreateComputerProviderServiceHandler(mux, computer_provider)
	services.CreateBasicComputerServiceHandler(mux, computer_provider)
	services.CreateGraphicComputerServiceHandler(mux, computer_provider)

	protocols := new(http.Protocols)

	// TODO: make a way to allow encrypted HTTP 2 by passing in TLS certs
	protocols.SetHTTP1(true)
	protocols.SetUnencryptedHTTP2(true)

	server := http.Server{
		Addr:      "localhost:8080", // TODO: make this configurable
		Handler:   mux,
		Protocols: protocols,
	}

	server.ListenAndServe()
}
