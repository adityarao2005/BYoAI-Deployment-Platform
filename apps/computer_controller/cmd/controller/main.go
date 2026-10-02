package main

import (
	"flag"
	"fmt"
	"os"

	"github.com/adityarao2005/BYoAI-Deployment-Platform/computer_controller/pkg/server"
)

// Set via -ldflags at build time
var (
	version   = "dev"
	gitCommit = "unknown"
	buildDate = "unknown"
)

func main() {
	showVersion := flag.Bool("version", false, "Show version information")
	flag.BoolVar(showVersion, "v", false, "Show version information")
	flag.Parse()

	if *showVersion {
		fmt.Printf("computer-controller version %s (commit: %s, built: %s)\n", version, gitCommit, buildDate)
		os.Exit(0)
	}

	server.RunServer()
}
