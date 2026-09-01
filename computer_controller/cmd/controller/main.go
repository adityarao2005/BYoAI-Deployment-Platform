package main

import (
	"fmt"

	"github.com/adityarao2005/BYoAI-Deployment-Platform/computer_controller/pkg/server"
)

func main() {
	fmt.Println("Starting Computer Controller Service...")

	server.RunServer()
}
