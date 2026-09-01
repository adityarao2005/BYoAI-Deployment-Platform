package server

import (
	"net/http"

	"github.com/adityarao2005/BYoAI-Deployment-Platform/computer_controller/pkg/services"
)

func RunServer() {
	mux := http.NewServeMux()

	services.CreateComputerProviderServiceHandler(mux)
	services.CreateBasicComputerServiceHandler(mux)
	services.CreateGraphicComputerServiceHandler(mux)

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
